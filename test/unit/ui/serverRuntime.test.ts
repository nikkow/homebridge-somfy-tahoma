import { RequestError } from '@homebridge/plugin-ui-utils';
import { describe, expect, it, vi } from 'vitest';

import { buildUiRequestHandlers } from '../../../src/ui/serverRuntime.js';

describe('buildUiRequestHandlers', () => {
  it('validates discovery timeout range', async () => {
    const handlers = buildUiRequestHandlers();

    await expect(handlers.handleDiscover({ timeoutMs: 999 })).rejects.toMatchObject({
      message: 'Invalid timeout value for discovery.',
      requestError: { status: 400 },
    });

    await expect(handlers.handleDiscover({ timeoutMs: 15001 })).rejects.toMatchObject({
      message: 'Invalid timeout value for discovery.',
      requestError: { status: 400 },
    });
  });

  it('returns discovered gateways sorted by name-host-port', async () => {
    const discoverGateways = vi.fn().mockResolvedValue([
      { name: 'Beta', host: '192.168.1.11', port: 8443 },
      { name: 'Alpha', host: '192.168.1.10', port: 8443 },
      { name: 'Alpha', host: '192.168.1.09', port: 9443 },
    ]);

    const handlers = buildUiRequestHandlers({
      discoverGateways,
    });

    await expect(handlers.handleDiscover({ timeoutMs: 5000 })).resolves.toEqual([
      { name: 'Alpha', host: '192.168.1.09', port: 9443 },
      { name: 'Alpha', host: '192.168.1.10', port: 8443 },
      { name: 'Beta', host: '192.168.1.11', port: 8443 },
    ]);

    expect(discoverGateways).toHaveBeenCalledWith(5000);
  });

  it('wraps discovery errors into RequestError 500', async () => {
    const handlers = buildUiRequestHandlers({
      discoverGateways: vi.fn().mockRejectedValue(new Error('mdns crashed')),
    });

    await expect(handlers.handleDiscover(undefined)).rejects.toMatchObject({
      message: 'Unable to discover TaHoma gateways: mdns crashed',
      requestError: { status: 500 },
    });
  });

  it('validates host and token inputs', async () => {
    const handlers = buildUiRequestHandlers();

    await expect(handlers.handleValidate(undefined)).rejects.toMatchObject({
      message: 'Missing gateway host.',
      requestError: { status: 400 },
    });

    await expect(handlers.handleValidate({ host: '192.168.1.10', token: '' })).rejects.toMatchObject({
      message: 'Missing gateway token.',
      requestError: { status: 400 },
    });
  });

  it('returns normalized host and mapped supported/unsupported devices', async () => {
    const getDevices = vi.fn().mockResolvedValue([
      {
        deviceURL: 'io://roller/1',
        label: 'Roller',
      },
    ]);

    const createApiClient = vi.fn(() => ({
      getDevices,
    }));

    const classifyDevices = vi.fn().mockReturnValue({
      supported: [
        {
          deviceURL: 'io://roller/1',
          label: 'Roller',
          controllableName: 'io:RollerShutter',
          kind: 'rollerShutter',
          commands: { open: 'open', close: 'close' },
          states: [],
        },
      ],
      unsupported: [
        {
          deviceURL: 'io://unknown/1',
          label: 'Unknown',
          controllableName: 'io:Light',
          reason: 'Unsupported controllable type',
        },
      ],
    });

    const handlers = buildUiRequestHandlers({
      normalizeGatewayHostFn: vi.fn().mockReturnValue({ hostname: 'gateway.local', port: 8443 }),
      createApiClient,
      classifyDevices,
    });

    await expect(handlers.handleValidate({ host: 'gateway.local', token: 'abc' })).resolves.toEqual({
      normalizedHost: 'gateway.local',
      normalizedPort: 8443,
      supportedDevices: [
        {
          deviceURL: 'io://roller/1',
          label: 'Roller',
          controllableName: 'io:RollerShutter',
          kind: 'rollerShutter',
        },
      ],
      unsupportedDevices: [
        {
          deviceURL: 'io://unknown/1',
          label: 'Unknown',
          controllableName: 'io:Light',
          reason: 'Unsupported controllable type',
        },
      ],
    });

    expect(createApiClient).toHaveBeenCalledWith({ host: 'gateway.local', token: 'abc', timeoutMs: 10_000 });
    expect(getDevices).toHaveBeenCalledTimes(1);
    expect(classifyDevices).toHaveBeenCalledTimes(1);
  });

  it('wraps invalid host or API errors in RequestError with status code', async () => {
    const handlersInvalidHost = buildUiRequestHandlers({
      normalizeGatewayHostFn: vi.fn(() => {
        throw new Error('not https');
      }),
    });

    await expect(handlersInvalidHost.handleValidate({ host: 'http://foo', token: 'abc' })).rejects.toMatchObject({
      message: 'Invalid gateway host: not https',
      requestError: { status: 400 },
    });

    const handlersApiError = buildUiRequestHandlers({
      normalizeGatewayHostFn: vi.fn().mockReturnValue({ hostname: 'gateway.local', port: 8443 }),
      createApiClient: vi.fn(() => ({
        getDevices: vi.fn().mockRejectedValue(new Error('connection refused')),
      })),
      classifyDevices: vi.fn(),
    });

    await expect(handlersApiError.handleValidate({ host: 'gateway.local', token: 'abc' })).rejects.toMatchObject({
      message: 'Unable to validate TaHoma connection: connection refused',
      requestError: { status: 500 },
    });
  });

  it('still returns RequestError instances', async () => {
    const handlers = buildUiRequestHandlers({
      discoverGateways: vi.fn(() => {
        throw new Error('boom');
      }),
    });

    try {
      await handlers.handleDiscover(undefined);
    } catch (error) {
      expect(error).toBeInstanceOf(RequestError);
    }
  });
});
