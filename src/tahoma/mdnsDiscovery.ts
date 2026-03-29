import bonjour from 'bonjour';
import { isIP } from 'node:net';

import type { TahomaDiscoveryResult } from './types.js';

const SERVICE_TYPE_PREFIX = 'kizbox';
const SERVICE_PROTOCOL = 'tcp';
const DEFAULT_DISCOVERY_TIMEOUT_MS = 3000;

function normalizeHost(host: string): string {
  return host.trim().replace(/\.$/, '');
}

function getTxtStringValue(source: Record<string, string> | undefined, key: string): string | undefined {
  const value = source?.[key];

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}

function matchesKizboxService(service: bonjour.RemoteService): boolean {
  const serviceType = typeof service.type === 'string' ? service.type.toLowerCase() : '';
  const protocol = typeof service.protocol === 'string' ? service.protocol.toLowerCase() : '';

  return serviceType.startsWith(SERVICE_TYPE_PREFIX) && protocol === SERVICE_PROTOCOL;
}

function pickBestIp(service: bonjour.RemoteService): string | undefined {
  const addresses = Array.isArray(service.addresses)
    ? service.addresses.map((address) => address.trim()).filter((address) => address.length > 0)
    : [];

  const ipv4 = addresses.find((address) => isIP(address) === 4);

  if (ipv4) {
    return ipv4;
  }

  const ipv6 = addresses.find((address) => isIP(address) === 6);

  if (ipv6) {
    return ipv6;
  }

  if (typeof service.host === 'string') {
    const host = normalizeHost(service.host);

    if (isIP(host) !== 0) {
      return host;
    }
  }

  return undefined;
}

function mergeDiscoveryEntry(existing: TahomaDiscoveryResult, candidate: TahomaDiscoveryResult): TahomaDiscoveryResult {
  return {
    name: existing.name === 'TaHoma Gateway' ? candidate.name : existing.name,
    host: existing.host,
    port: existing.port || candidate.port,
    gatewayPin: existing.gatewayPin ?? candidate.gatewayPin,
    apiVersion: existing.apiVersion ?? candidate.apiVersion,
    fwVersion: existing.fwVersion ?? candidate.fwVersion,
  };
}

export function discoverTahomaGateways(timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS): Promise<TahomaDiscoveryResult[]> {
  return new Promise((resolve) => {
    const instance = bonjour();
    const browser = instance.find({});

    const discoveredByIp = new Map<string, TahomaDiscoveryResult>();
    let closed = false;

    const finalize = () => {
      if (closed) {
        return;
      }

      closed = true;
      browser.stop();
      instance.destroy();

      const items = [...discoveredByIp.values()]
        .sort((left, right) => `${left.name}-${left.host}`.localeCompare(`${right.name}-${right.host}`));

      resolve(items);
    };

    browser.on('up', (service: bonjour.RemoteService) => {
      if (!matchesKizboxService(service)) {
        return;
      }

      const ip = pickBestIp(service);

      if (!ip) {
        return;
      }

      const candidate: TahomaDiscoveryResult = {
        name: typeof service.name === 'string' && service.name.trim().length > 0
          ? service.name.trim()
          : 'TaHoma Gateway',
        host: ip,
        port: typeof service.port === 'number' ? service.port : 8443,
        gatewayPin: getTxtStringValue(service.txt, 'gateway_pin'),
        apiVersion: getTxtStringValue(service.txt, 'api_version'),
        fwVersion: getTxtStringValue(service.txt, 'fw_version'),
      };

      const existing = discoveredByIp.get(ip);

      if (existing) {
        discoveredByIp.set(ip, mergeDiscoveryEntry(existing, candidate));
        return;
      }

      discoveredByIp.set(ip, candidate);
    });

    setTimeout(finalize, timeoutMs);
  });
}
