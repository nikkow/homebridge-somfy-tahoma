import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import { TahomaApiClient, normalizeGatewayHost } from '../tahoma/apiClient.js';
import { classifyTahomaDevices } from '../tahoma/deviceSupport.js';
import { discoverTahomaGateways } from '../tahoma/mdnsDiscovery.js';
import type { TahomaDiscoveryResult } from '../tahoma/types.js';

interface DiscoverRequestPayload {
  timeoutMs?: number;
}

interface ValidateRequestPayload {
  host?: string;
  token?: string;
}

export interface ValidationResponse {
  normalizedHost: string;
  normalizedPort: number;
  supportedDevices: Array<{
    deviceURL: string;
    label: string;
    controllableName: string;
    kind: 'garageDoor' | 'rollerShutter';
  }>;
  unsupportedDevices: Array<{
    deviceURL: string;
    label: string;
    controllableName: string;
    reason: string;
  }>;
}

export interface UiServerDependencies {
  discoverGateways?: typeof discoverTahomaGateways;
  normalizeGatewayHostFn?: typeof normalizeGatewayHost;
  createApiClient?: (options: { host: string; token: string; timeoutMs: number }) => Pick<TahomaApiClient, 'getDevices'>;
  classifyDevices?: typeof classifyTahomaDevices;
}

interface UiRequestHandlers {
  handleDiscover: (payload: DiscoverRequestPayload | undefined) => Promise<TahomaDiscoveryResult[]>;
  handleValidate: (payload: ValidateRequestPayload | undefined) => Promise<ValidationResponse>;
}

export function buildUiRequestHandlers(dependencies: UiServerDependencies = {}): UiRequestHandlers {
  const discoverGateways = dependencies.discoverGateways ?? discoverTahomaGateways;
  const normalizeGatewayHostFn = dependencies.normalizeGatewayHostFn ?? normalizeGatewayHost;
  const createApiClient = dependencies.createApiClient ?? ((options) => new TahomaApiClient(options));
  const classifyDevices = dependencies.classifyDevices ?? classifyTahomaDevices;

  return {
    async handleDiscover(payload: DiscoverRequestPayload | undefined): Promise<TahomaDiscoveryResult[]> {
      const timeoutMs = payload?.timeoutMs;

      if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || timeoutMs < 1000 || timeoutMs > 15_000)) {
        throw new RequestError('Invalid timeout value for discovery.', { status: 400 });
      }

      try {
        const gateways = await discoverGateways(timeoutMs ?? 3000);

        return gateways.sort((a, b) => {
          const left = `${a.name}-${a.host}-${a.port}`;
          const right = `${b.name}-${b.host}-${b.port}`;

          return left.localeCompare(right);
        });
      } catch (error) {
        throw new RequestError(`Unable to discover TaHoma gateways: ${(error as Error).message}`, { status: 500 });
      }
    },

    async handleValidate(payload: ValidateRequestPayload | undefined): Promise<ValidationResponse> {
      const host = payload?.host?.trim();
      const token = payload?.token?.trim();

      if (!host) {
        throw new RequestError('Missing gateway host.', { status: 400 });
      }

      if (!token) {
        throw new RequestError('Missing gateway token.', { status: 400 });
      }

      let normalizedHost: string;
      let normalizedPort: number;

      try {
        const normalized = normalizeGatewayHostFn(host);
        normalizedHost = normalized.hostname;
        normalizedPort = normalized.port;
      } catch (error) {
        throw new RequestError(`Invalid gateway host: ${(error as Error).message}`, { status: 400 });
      }

      const client = createApiClient({ host, token, timeoutMs: 10_000 });

      try {
        const devices = await client.getDevices();
        const classified = classifyDevices(devices);

        return {
          normalizedHost,
          normalizedPort,
          supportedDevices: classified.supported.map((device) => ({
            deviceURL: device.deviceURL,
            label: device.label,
            controllableName: device.controllableName,
            kind: device.kind,
          })),
          unsupportedDevices: classified.unsupported,
        };
      } catch (error) {
        throw new RequestError(`Unable to validate TaHoma connection: ${(error as Error).message}`, { status: 500 });
      }
    },
  };
}

class UiServer extends HomebridgePluginUiServer {
  private readonly requestHandlers: UiRequestHandlers;

  constructor(dependencies: UiServerDependencies = {}) {
    super();
    this.requestHandlers = buildUiRequestHandlers(dependencies);

    this.onRequest('/discover', this.requestHandlers.handleDiscover);
    this.onRequest('/validate', this.requestHandlers.handleValidate);

    this.ready();
  }
}

export function startUiServer(dependencies: UiServerDependencies = {}): UiServer {
  return new UiServer(dependencies);
}
