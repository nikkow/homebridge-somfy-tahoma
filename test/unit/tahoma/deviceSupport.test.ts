import { describe, expect, it } from 'vitest';

import { classifyTahomaDevices, toAccessoryDisplayName } from '../../../src/tahoma/deviceSupport.js';

describe('classifyTahomaDevices', () => {
  it('classifies roller shutters and garage doors with command aliases', () => {
    const result = classifyTahomaDevices([
      {
        deviceURL: 'io://roller/1',
        label: 'Living Room',
        controllableName: 'io:RollerShutterVeluxIOComponent',
        definition: {
          commands: [
            { commandName: 'open' },
            { commandName: 'close' },
            { commandName: 'my' },
          ],
        },
        states: [{ name: 'core:ClosureState', value: 50 }],
      },
      {
        deviceURL: 'io://garage/1',
        controllableName: 'io:GarageDoorOpener',
        definition: {
          commands: [
            { commandName: 'Open_Overkiz' },
            { commandName: 'closeNow' },
          ],
        },
      },
    ]);

    expect(result.unsupported).toHaveLength(0);
    expect(result.supported).toHaveLength(2);

    expect(result.supported[0]).toMatchObject({
      deviceURL: 'io://roller/1',
      label: 'Living Room',
      kind: 'rollerShutter',
      commands: {
        open: 'open',
        close: 'close',
        stop: 'my',
      },
      states: [{ name: 'core:ClosureState', value: 50 }],
    });

    expect(result.supported[1]).toMatchObject({
      deviceURL: 'io://garage/1',
      kind: 'garageDoor',
      commands: {
        open: 'Open_Overkiz',
        close: 'closeNow',
      },
    });
  });

  it('skips entries without deviceURL', () => {
    const result = classifyTahomaDevices([
      {
        deviceURL: '',
        controllableName: 'io:RollerShutterVeluxIOComponent',
      },
    ]);

    expect(result.supported).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });

  it('reports unsupported type and missing commands', () => {
    const result = classifyTahomaDevices([
      {
        deviceURL: 'io://light/1',
        label: 'Kitchen light',
        controllableName: 'io:LightSensor',
        definition: {
          commands: [{ commandName: 'on' }],
        },
      },
      {
        deviceURL: 'io://garage/2',
        controllableName: 'io:GarageDoorOpener',
        definition: {
          commands: [{ commandName: 'open' }],
        },
      },
    ]);

    expect(result.supported).toHaveLength(0);
    expect(result.unsupported).toHaveLength(2);
    expect(result.unsupported[0].reason).toContain('Unsupported controllable type');
    expect(result.unsupported[1].reason).toContain('Missing mandatory open/close commands');
  });

  it('uses fallback label and default unknown controllable name', () => {
    const result = classifyTahomaDevices([
      {
        deviceURL: 'io://garage/3',
        definition: {
          commands: [
            { commandName: 'open' },
            { commandName: 'close' },
          ],
        },
      },
    ]);

    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toMatchObject({
      label: 'io://garage/3',
      controllableName: 'unknown',
    });
  });
});

describe('toAccessoryDisplayName', () => {
  it('returns label when provided', () => {
    expect(toAccessoryDisplayName({
      deviceURL: 'io://roller/5',
      label: 'Bedroom',
      kind: 'rollerShutter',
      commands: { open: 'open', close: 'close' },
      controllableName: 'io:RollerShutter',
      states: [],
    })).toBe('Bedroom');
  });

  it('falls back to device URL', () => {
    expect(toAccessoryDisplayName({
      deviceURL: 'io://roller/6',
      label: '',
      kind: 'rollerShutter',
      commands: { open: 'open', close: 'close' },
      controllableName: 'io:RollerShutter',
      states: [],
    })).toBe('io://roller/6');
  });
});
