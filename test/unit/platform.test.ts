import { describe, expect, it, vi } from 'vitest';

import { SomfyTahomaPlatform } from '../../src/platform.js';
import type { TahomaDevice } from '../../src/tahoma/types.js';
import {
  createMockHomebridgeApi,
  createMockLogger,
} from './helpers/homebridgeMocks.js';

function createSupportedDevice(deviceURL = 'io://roller/1', label = 'Roller 1'): TahomaDevice {
  return {
    deviceURL,
    label,
    controllableName: 'io:RollerShutterVeluxIOComponent',
    definition: {
      commands: [
        { commandName: 'open' },
        { commandName: 'close' },
      ],
    },
    states: [{ name: 'core:ClosureState', value: 50 }],
  };
}

describe('SomfyTahomaPlatform', () => {
  it('logs missing config only once', async () => {
    const { api } = createMockHomebridgeApi();
    const log = createMockLogger();
    const createApiClient = vi.fn();

    const platform = new SomfyTahomaPlatform(log as any, { name: 'Somfy' } as any, api as any, {
      createApiClient: createApiClient as any,
    });

    await platform.refreshNow();
    await platform.refreshNow();

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('TaHoma platform is not fully configured. Please set both ip and token.');
    expect(createApiClient).not.toHaveBeenCalled();
  });

  it('adds, updates and removes accessories from sync results', async () => {
    const { api } = createMockHomebridgeApi();
    const log = createMockLogger();

    const getDevices = vi
      .fn<() => Promise<TahomaDevice[]>>()
      .mockResolvedValueOnce([createSupportedDevice('io://roller/1', 'Living')])
      .mockResolvedValueOnce([createSupportedDevice('io://roller/1', 'Living Updated')])
      .mockResolvedValueOnce([]);

    const executeCommand = vi.fn().mockResolvedValue(undefined);
    const createApiClient = vi.fn(() => ({
      getDevices,
      executeCommand,
    }));

    const createdHandlers: Array<{ updateContext: ReturnType<typeof vi.fn>; updateStates: ReturnType<typeof vi.fn> }> = [];

    const createAccessoryHandler = vi.fn(() => {
      const handler = {
        updateContext: vi.fn(),
        updateStates: vi.fn(),
      };

      createdHandlers.push(handler);
      return handler as any;
    });

    const platform = new SomfyTahomaPlatform(log as any, {
      name: 'Somfy',
      ip: '192.168.1.10',
      token: 'abc',
    } as any, api as any, {
      createApiClient: createApiClient as any,
      createAccessoryHandler: createAccessoryHandler as any,
    });

    await platform.refreshNow();

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(api.updatePlatformAccessories).toHaveBeenCalled();
    expect(platform.accessories.size).toBe(1);
    expect(createdHandlers[0].updateStates).toHaveBeenCalledTimes(1);

    await platform.refreshNow();

    expect(createAccessoryHandler).toHaveBeenCalledTimes(1);
    expect(createdHandlers[0].updateContext).toHaveBeenCalledTimes(1);
    expect(createdHandlers[0].updateStates).toHaveBeenCalledTimes(2);

    await platform.refreshNow();

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(platform.accessories.size).toBe(0);
  });

  it('ignores configured device URLs and logs unsupported devices', async () => {
    const { api } = createMockHomebridgeApi();
    const log = createMockLogger();

    const getDevices = vi.fn().mockResolvedValue([
      createSupportedDevice('io://roller/ignored', 'Ignored device'),
      {
        deviceURL: 'io://unknown/1',
        label: 'Unknown',
        controllableName: 'io:LightSensor',
        definition: {
          commands: [{ commandName: 'on' }],
        },
      },
    ] satisfies TahomaDevice[]);

    const platform = new SomfyTahomaPlatform(log as any, {
      name: 'Somfy',
      ip: '192.168.1.10',
      token: 'abc',
      ignoredDeviceUrls: ['io://roller/ignored'],
    } as any, api as any, {
      createApiClient: () => ({
        getDevices,
        executeCommand: vi.fn(),
      }),
      createAccessoryHandler: () => ({
        updateContext: vi.fn(),
        updateStates: vi.fn(),
      } as any),
    });

    await platform.refreshNow();

    expect(platform.accessories.size).toBe(0);
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith('Skipped 1 unsupported devices.');
  });

  it('swallows known Homebridge race errors and keeps running', async () => {
    const { api } = createMockHomebridgeApi();
    const log = createMockLogger();

    const getDevices = vi
      .fn<() => Promise<TahomaDevice[]>>()
      .mockResolvedValueOnce([createSupportedDevice('io://roller/race')])
      .mockResolvedValueOnce([]);

    api.registerPlatformAccessories.mockImplementation(() => {
      throw new Error('Accessory already registered while it was already bridged by another bridge.');
    });

    api.unregisterPlatformAccessories.mockImplementation(() => {
      throw new Error('Cannot find the bridged Accessory to remove.');
    });

    const platform = new SomfyTahomaPlatform(log as any, {
      name: 'Somfy',
      ip: '192.168.1.10',
      token: 'abc',
    } as any, api as any, {
      createApiClient: () => ({
        getDevices,
        executeCommand: vi.fn(),
      }),
      createAccessoryHandler: () => ({
        updateContext: vi.fn(),
        updateStates: vi.fn(),
      } as any),
    });

    await expect(platform.refreshNow()).resolves.toBeUndefined();
    await expect(platform.refreshNow()).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring duplicate accessory registration'));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring duplicate accessory unregistration'));
  });

  it('serializes sync calls through internal queue', async () => {
    const { api } = createMockHomebridgeApi();
    const log = createMockLogger();

    let resolveFirstCall: ((devices: TahomaDevice[]) => void) | undefined;

    const firstCall = new Promise<TahomaDevice[]>((resolve) => {
      resolveFirstCall = resolve;
    });

    const getDevices = vi
      .fn<() => Promise<TahomaDevice[]>>()
      .mockReturnValueOnce(firstCall)
      .mockResolvedValueOnce([]);

    const platform = new SomfyTahomaPlatform(log as any, {
      name: 'Somfy',
      ip: '192.168.1.10',
      token: 'abc',
    } as any, api as any, {
      createApiClient: () => ({
        getDevices,
        executeCommand: vi.fn(),
      }),
      createAccessoryHandler: () => ({
        updateContext: vi.fn(),
        updateStates: vi.fn(),
      } as any),
    });

    const firstRefresh = platform.refreshNow();
    const secondRefresh = platform.refreshNow();
    let secondResolved = false;
    secondRefresh.then(() => {
      secondResolved = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    resolveFirstCall?.([]);

    await firstRefresh;
    await secondRefresh;

    expect(getDevices).toHaveBeenCalledTimes(2);
  });

  it('registers launch/shutdown callbacks and uses injected timer functions', async () => {
    const { api, emit } = createMockHomebridgeApi();
    const log = createMockLogger();

    const getDevices = vi.fn().mockResolvedValue([] as TahomaDevice[]);

    let pollCallback: (() => void) | undefined;
    const timerHandle = {} as NodeJS.Timeout;

    const setIntervalFn = vi.fn((callback: () => void, interval: number) => {
      pollCallback = callback;
      expect(interval).toBe(3000);
      return timerHandle;
    });

    const clearIntervalFn = vi.fn();

    new SomfyTahomaPlatform(log as any, {
      name: 'Somfy',
      ip: '192.168.1.10',
      token: 'abc',
    } as any, api as any, {
      createApiClient: () => ({
        getDevices,
        executeCommand: vi.fn(),
      }),
      createAccessoryHandler: () => ({
        updateContext: vi.fn(),
        updateStates: vi.fn(),
      } as any),
      setIntervalFn,
      clearIntervalFn,
    });

    emit('didFinishLaunching');
    await Promise.resolve();
    await Promise.resolve();

    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(getDevices).toHaveBeenCalledTimes(1);

    pollCallback?.();
    await vi.waitFor(() => {
      expect(getDevices).toHaveBeenCalledTimes(2);
    });

    emit('shutdown');

    expect(clearIntervalFn).toHaveBeenCalledWith(timerHandle);
  });

  it('forwards explicit device command execution', async () => {
    const { api } = createMockHomebridgeApi();
    const log = createMockLogger();

    const executeCommand = vi.fn().mockResolvedValue(undefined);

    const platform = new SomfyTahomaPlatform(log as any, {
      name: 'Somfy',
      ip: '192.168.1.10',
      token: 'abc',
    } as any, api as any, {
      createApiClient: () => ({
        getDevices: vi.fn().mockResolvedValue([]),
        executeCommand,
      }),
      createAccessoryHandler: () => ({
        updateContext: vi.fn(),
        updateStates: vi.fn(),
      } as any),
    });

    await platform.executeDeviceCommand('io://roller/5', 'open');

    expect(executeCommand).toHaveBeenCalledWith('io://roller/5', 'open');
  });
});
