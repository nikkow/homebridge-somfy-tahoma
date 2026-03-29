import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { discoverTahomaGateways } from '../../../src/tahoma/mdnsDiscovery.js';

class MockBrowser extends EventEmitter {
  stop = vi.fn();
}

describe('discoverTahomaGateways', () => {
  it('filters services, merges duplicates and sorts results', async () => {
    const browser = new MockBrowser();
    const destroy = vi.fn();
    const find = vi.fn(() => browser);
    let finalize: (() => void) | undefined;

    const setTimeoutFn = vi.fn((callback: () => void) => {
      finalize = callback;
      return {} as NodeJS.Timeout;
    });

    const promise = discoverTahomaGateways(1234, {
      createBonjourInstance: () => ({
        find,
        destroy,
      } as any),
      setTimeoutFn,
    });

    browser.emit('up', {
      type: 'airplay',
      protocol: 'tcp',
      addresses: ['192.168.1.2'],
      host: 'ignored.local.',
      name: 'Should be ignored',
      port: 7000,
      txt: {},
    });

    browser.emit('up', {
      type: 'kizboxdev',
      protocol: 'tcp',
      addresses: [' 192.168.1.10 '],
      host: 'ignored.local.',
      name: ' ',
      port: 8443,
      txt: {
        gateway_pin: '1111',
      },
    });

    browser.emit('up', {
      type: 'kizboxdev',
      protocol: 'tcp',
      addresses: ['192.168.1.10'],
      name: 'TaHoma Main',
      port: 8443,
      txt: {
        api_version: '1.2',
        fw_version: '2.3',
      },
    });

    browser.emit('up', {
      type: 'kizboxdev',
      protocol: 'tcp',
      addresses: ['fe80::abcd', '10.0.0.8'],
      host: 'foo.local.',
      name: 'Secondary',
      port: 8443,
      txt: {},
    });

    browser.emit('up', {
      type: 'kizboxpro',
      protocol: 'tcp',
      addresses: [],
      host: '10.0.0.9.',
      name: 'Host Fallback',
      port: 9443,
      txt: {},
    });

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 1234);
    expect(finalize).toBeTypeOf('function');

    finalize?.();
    finalize?.();

    const result = await promise;

    expect(find).toHaveBeenCalledWith({});
    expect(browser.stop).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);

    expect(result).toEqual([
      {
        name: 'Host Fallback',
        host: '10.0.0.9',
        port: 9443,
        gatewayPin: undefined,
        apiVersion: undefined,
        fwVersion: undefined,
      },
      {
        name: 'Secondary',
        host: '10.0.0.8',
        port: 8443,
        gatewayPin: undefined,
        apiVersion: undefined,
        fwVersion: undefined,
      },
      {
        name: 'TaHoma Main',
        host: '192.168.1.10',
        port: 8443,
        gatewayPin: '1111',
        apiVersion: '1.2',
        fwVersion: '2.3',
      },
    ]);
  });

  it('returns empty list when no service matches', async () => {
    const browser = new MockBrowser();
    let finalize: (() => void) | undefined;

    const promise = discoverTahomaGateways(3000, {
      createBonjourInstance: () => ({
        find: () => browser,
        destroy: vi.fn(),
      } as any),
      setTimeoutFn: (callback: () => void) => {
        finalize = callback;
        return {} as NodeJS.Timeout;
      },
    });

    browser.emit('up', {
      type: 'googlecast',
      protocol: 'udp',
      addresses: ['192.168.1.20'],
      host: 'foo.local',
      name: 'Cast',
      txt: {},
    });

    finalize?.();
    await expect(promise).resolves.toEqual([]);
  });
});
