import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { connect as tlsConnect, rootCertificates } from 'node:tls';
import type { PeerCertificate, TLSSocket } from 'node:tls';

import { OVERKIZ_ROOT_CA } from './ca.js';
import type { TahomaDevice } from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_GATEWAY_PORT = 8443;
const API_BASE_PATH = '/enduser-mobile-web/1/enduserAPI';
const CERTIFICATE_RETRY_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);
const STRICT_CA_BUNDLE = [OVERKIZ_ROOT_CA, ...rootCertificates];
type HttpMethod = 'GET' | 'POST' | 'DELETE';

export interface TahomaApiClientOptions {
  host: string;
  token: string;
  timeoutMs?: number;
}

interface GatewayAddress {
  hostname: string;
  port: number;
}

export function normalizeGatewayHost(rawHost: string): GatewayAddress {
  const host = rawHost.trim();

  if (!host) {
    throw new Error('Gateway host is required');
  }

  const asUrl = host.includes('://') ? new URL(host) : new URL(`https://${host}`);

  if (asUrl.protocol !== 'https:') {
    throw new Error('Gateway must use HTTPS');
  }

  return {
    hostname: asUrl.hostname,
    port: asUrl.port ? Number(asUrl.port) : DEFAULT_GATEWAY_PORT,
  };
}

export class TahomaApiClient {
  private readonly gateway: GatewayAddress;
  private readonly token: string;
  private readonly timeoutMs: number;
  private pinnedPeerFingerprint256?: string;

  constructor(options: TahomaApiClientOptions) {
    this.gateway = normalizeGatewayHost(options.host);
    this.token = options.token.trim();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!this.token) {
      throw new Error('Gateway token is required');
    }
  }

  async getDevices(): Promise<TahomaDevice[]> {
    return this.requestJson<TahomaDevice[]>('/setup/devices', { method: 'GET' });
  }

  async executeCommand(deviceURL: string, commandName: string): Promise<void> {
    const payload = {
      actions: [
        {
          deviceURL,
          commands: [
            {
              name: commandName,
            },
          ],
        },
      ],
    };

    await this.requestJson('/exec/apply', {
      method: 'POST',
      body: payload,
    });
  }

  private async requestJson<T = unknown>(
    path: string,
    options: { method: HttpMethod; body?: unknown },
  ): Promise<T> {
    try {
      return await this.requestJsonOnce<T>(path, options, {
        ca: STRICT_CA_BUNDLE,
      });
    } catch (error) {
      if (this.shouldRetryWithDefaultTrustStore(error)) {
        return this.requestWithPinnedPeerCertificate<T>(path, options);
      }

      throw error;
    }
  }

  private async requestWithPinnedPeerCertificate<T = unknown>(
    path: string,
    options: { method: HttpMethod; body?: unknown },
  ): Promise<T> {
    await this.loadAndPinPeerCertificate();

    try {
      return await this.requestJsonOnce<T>(path, options, {
        rejectUnauthorized: false,
        expectedPeerFingerprint256: this.pinnedPeerFingerprint256,
      });
    } catch (error) {
      if (!this.isPeerFingerprintMismatch(error)) {
        throw error;
      }

      this.pinnedPeerFingerprint256 = undefined;
      await this.loadAndPinPeerCertificate();

      return this.requestJsonOnce<T>(path, options, {
        rejectUnauthorized: false,
        expectedPeerFingerprint256: this.pinnedPeerFingerprint256,
      });
    }
  }

  private shouldRetryWithDefaultTrustStore(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const nodeError = error as Error & { code?: string };

    if (nodeError.code && CERTIFICATE_RETRY_CODES.has(nodeError.code)) {
      return true;
    }

    return /self-signed certificate/i.test(nodeError.message)
      || /does not match certificate's altnames/i.test(nodeError.message)
      || /unable to get local issuer certificate/i.test(nodeError.message);
  }

  private isPeerFingerprintMismatch(error: unknown): boolean {
    return error instanceof Error && /peer certificate fingerprint mismatch/i.test(error.message);
  }

  private async requestJsonOnce<T = unknown>(
    path: string,
    options: { method: HttpMethod; body?: unknown },
    tlsOptions: {
      ca?: string | string[];
      checkServerIdentity?: (hostname: string, cert: PeerCertificate) => Error | undefined;
      rejectUnauthorized?: boolean;
      expectedPeerFingerprint256?: string;
    },
  ): Promise<T> {
    const requestBody = options.body === undefined ? undefined : JSON.stringify(options.body);
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const requestPath = `${API_BASE_PATH}${normalizedPath}`;

    return new Promise<T>((resolve, reject) => {
      const req = httpsRequest({
        hostname: this.gateway.hostname,
        port: this.gateway.port,
        path: requestPath,
        method: options.method,
        rejectUnauthorized: tlsOptions.rejectUnauthorized ?? true,
        ...tlsOptions,
        ...(isIP(this.gateway.hostname) === 0
          ? { servername: this.gateway.hostname }
          : {}),
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.token}`,
          ...(requestBody === undefined ? {} : {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody),
          }),
        },
      }, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const statusCode = res.statusCode ?? 500;
          const payload = Buffer.concat(chunks).toString('utf8').trim();

          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`TaHoma API request failed with status ${statusCode}: ${payload || 'no response body'}`));
            return;
          }

          if (!payload) {
            resolve(undefined as T);
            return;
          }

          try {
            resolve(JSON.parse(payload) as T);
          } catch (error) {
            reject(new Error(`TaHoma API returned invalid JSON: ${(error as Error).message}`));
          }
        });
      });

      if (tlsOptions.expectedPeerFingerprint256) {
        req.on('socket', (socket) => {
          socket.once('secureConnect', () => {
            const tlsSocket = socket as unknown as TLSSocket;
            const certificate = tlsSocket.getPeerCertificate(true);

            if (!certificate.fingerprint256 || certificate.fingerprint256 !== tlsOptions.expectedPeerFingerprint256) {
              req.destroy(new Error(
                `Peer certificate fingerprint mismatch (expected ${tlsOptions.expectedPeerFingerprint256}, got ${certificate.fingerprint256 ?? 'none'}).`,
              ));
            }
          });
        });
      }

      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new Error(`TaHoma API request timeout after ${this.timeoutMs}ms`));
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (requestBody !== undefined) {
        req.write(requestBody);
      }

      req.end();
    });
  }

  private async loadAndPinPeerCertificate(): Promise<void> {
    if (this.pinnedPeerFingerprint256) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = tlsConnect({
        host: this.gateway.hostname,
        port: this.gateway.port,
        rejectUnauthorized: false,
        ...(isIP(this.gateway.hostname) === 0
          ? { servername: this.gateway.hostname }
          : {}),
      });

      let settled = false;
      const finalize = (error?: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();

        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      socket.setTimeout(this.timeoutMs, () => {
        finalize(new Error(`TaHoma TLS pinning timeout after ${this.timeoutMs}ms`));
      });

      socket.once('error', (error) => {
        finalize(error);
      });

      socket.once('secureConnect', () => {
        const certificate = socket.getPeerCertificate(true);
        const raw = certificate.raw;
        const fingerprint256 = certificate.fingerprint256;

        if (!raw || !Buffer.isBuffer(raw) || !fingerprint256) {
          finalize(new Error('Unable to pin TaHoma peer certificate.'));
          return;
        }

        this.pinnedPeerFingerprint256 = fingerprint256;
        finalize();
      });
    });
  }
}
