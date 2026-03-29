import { describe, expect, it, vi } from 'vitest';

import type { SomfyAccessoryContext } from '../../src/platformTypes.js';
import { SomfyTahomaAccessory } from '../../src/platformAccessory.js';
import {
  FakePlatformAccessory,
  createMockHap,
  createMockLogger,
} from './helpers/homebridgeMocks.js';

function createContext(overrides: Partial<SomfyAccessoryContext> = {}): SomfyAccessoryContext {
  return {
    deviceURL: 'io://device/1',
    label: 'Device 1',
    kind: 'rollerShutter',
    commands: {
      open: 'open',
      close: 'close',
      stop: 'stop',
    },
    controllableName: 'io:RollerShutter',
    ...overrides,
  };
}

function createAccessoryFixture(context: SomfyAccessoryContext = createContext()) {
  const hap = createMockHap();
  const accessory = new FakePlatformAccessory(context.label, 'uuid-device');
  accessory.context.device = context;

  const platform = {
    Service: hap.Service,
    Characteristic: hap.Characteristic,
    api: { hap },
    log: createMockLogger(),
    executeDeviceCommand: vi.fn().mockResolvedValue(undefined),
    refreshNow: vi.fn().mockResolvedValue(undefined),
  };

  const handler = new SomfyTahomaAccessory(platform as any, accessory as any);

  return {
    hap,
    accessory,
    platform,
    handler,
  };
}

describe('SomfyTahomaAccessory', () => {
  it('maps roller shutter states to HomeKit characteristics', () => {
    const { hap, accessory, handler } = createAccessoryFixture();

    handler.updateStates([
      { name: 'core:ClosureState', value: 35 },
      { name: 'core:MovingState', value: 'up' },
    ]);

    const service = accessory.getService(hap.Service.WindowCovering)!;

    expect(service.getValue(hap.Characteristic.CurrentPosition)).toBe(65);
    expect(service.getValue(hap.Characteristic.TargetPosition)).toBe(100);
    expect(service.getValue(hap.Characteristic.PositionState)).toBe(hap.Characteristic.PositionState.INCREASING);
  });

  it('maps garage states to HomeKit characteristics', () => {
    const context = createContext({
      kind: 'garageDoor',
      controllableName: 'io:GarageDoorOpener',
    });

    const { hap, accessory, handler } = createAccessoryFixture(context);

    handler.updateStates([
      { name: 'core:OpenClosedState', value: 'closing' },
    ]);

    const service = accessory.getService(hap.Service.GarageDoorOpener)!;

    expect(service.getValue(hap.Characteristic.CurrentDoorState)).toBe(hap.Characteristic.CurrentDoorState.CLOSING);
    expect(service.getValue(hap.Characteristic.TargetDoorState)).toBe(hap.Characteristic.TargetDoorState.CLOSED);
    expect(service.getValue(hap.Characteristic.ObstructionDetected)).toBe(false);
  });

  it('executes roller commands from TargetPosition set handler', async () => {
    const { hap, accessory, platform } = createAccessoryFixture();
    const service = accessory.getService(hap.Service.WindowCovering)!;

    const targetPosition = service.getCharacteristic(hap.Characteristic.TargetPosition);

    await targetPosition.triggerSet(55);
    await targetPosition.triggerSet(0);

    expect(platform.executeDeviceCommand).toHaveBeenNthCalledWith(1, 'io://device/1', 'open');
    expect(platform.executeDeviceCommand).toHaveBeenNthCalledWith(2, 'io://device/1', 'close');
    expect(platform.refreshNow).toHaveBeenCalledTimes(2);
  });

  it('converts garage command errors to HapStatusError', async () => {
    const context = createContext({
      kind: 'garageDoor',
      controllableName: 'io:GarageDoorOpener',
    });

    const { hap, accessory, platform } = createAccessoryFixture(context);

    platform.executeDeviceCommand.mockRejectedValue(new Error('TaHoma unavailable'));

    const service = accessory.getService(hap.Service.GarageDoorOpener)!;
    const targetDoor = service.getCharacteristic(hap.Characteristic.TargetDoorState);

    await expect(targetDoor.triggerSet(hap.Characteristic.TargetDoorState.OPEN)).rejects.toBeInstanceOf(hap.HapStatusError);

    expect(platform.log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to execute garage command'));
  });

  it('swaps service type when context kind changes', () => {
    const { hap, accessory, handler } = createAccessoryFixture();

    expect(accessory.hasService(hap.Service.WindowCovering)).toBe(true);
    expect(accessory.hasService(hap.Service.GarageDoorOpener)).toBe(false);

    handler.updateContext(createContext({
      kind: 'garageDoor',
      label: 'Garage',
      deviceURL: 'io://garage/1',
      controllableName: 'io:GarageDoorOpener',
    }));

    expect(accessory.hasService(hap.Service.WindowCovering)).toBe(false);
    expect(accessory.hasService(hap.Service.GarageDoorOpener)).toBe(true);
  });
});
