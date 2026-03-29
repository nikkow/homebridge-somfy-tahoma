import { describe, expect, it } from 'vitest';

import { mapGarageDoorState, mapRollerShutterState } from '../../../src/tahoma/stateMapper.js';

describe('mapRollerShutterState', () => {
  it('maps closure percentage to HomeKit coordinates', () => {
    const result = mapRollerShutterState([
      { name: 'core:ClosureState', value: 25 },
    ]);

    expect(result).toEqual({
      currentPosition: 75,
      targetPosition: 75,
      positionState: 'stopped',
    });
  });

  it('detects movement and sets target position to opened', () => {
    const result = mapRollerShutterState([
      { name: 'core:ClosureState', value: '80' },
      { name: 'core:MovingState', value: 'opening' },
    ]);

    expect(result).toEqual({
      currentPosition: 20,
      targetPosition: 100,
      positionState: 'increasing',
    });
  });

  it('falls back to openClosed state when closure value is missing', () => {
    const result = mapRollerShutterState([
      { name: 'core:OpenClosedState', value: 'closed' },
    ]);

    expect(result).toEqual({
      currentPosition: 0,
      targetPosition: 0,
      positionState: 'stopped',
    });
  });

  it('clamps out-of-range closure values', () => {
    const result = mapRollerShutterState([
      { name: 'core:ClosureState', value: 150 },
      { name: 'core:MovingState', value: 'closing' },
    ]);

    expect(result).toEqual({
      currentPosition: 0,
      targetPosition: 0,
      positionState: 'decreasing',
    });
  });

  it('keeps stopped state when values are unknown', () => {
    const result = mapRollerShutterState([
      { name: 'core:ClosureState', value: 'not-a-number' },
      { name: 'core:OpenClosedState', value: 'unknown' },
    ]);

    expect(result).toEqual({
      currentPosition: 0,
      targetPosition: 0,
      positionState: 'stopped',
    });
  });
});

describe('mapGarageDoorState', () => {
  it('maps explicit open/closed/opening/closing states', () => {
    expect(mapGarageDoorState([{ name: 'core:OpenClosedState', value: 'open' }])).toEqual({
      currentDoorState: 'open',
      targetDoorState: 'open',
    });

    expect(mapGarageDoorState([{ name: 'core:OpenClosedState', value: 'closed' }])).toEqual({
      currentDoorState: 'closed',
      targetDoorState: 'closed',
    });

    expect(mapGarageDoorState([{ name: 'core:OpenClosedState', value: 'opening' }])).toEqual({
      currentDoorState: 'opening',
      targetDoorState: 'open',
    });

    expect(mapGarageDoorState([{ name: 'core:OpenClosedState', value: 'closing' }])).toEqual({
      currentDoorState: 'closing',
      targetDoorState: 'closed',
    });
  });

  it('infers states from closure percentage thresholds', () => {
    expect(mapGarageDoorState([{ name: 'core:ClosureState', value: 5 }])).toEqual({
      currentDoorState: 'open',
      targetDoorState: 'open',
    });

    expect(mapGarageDoorState([{ name: 'core:ClosureState', value: 95 }])).toEqual({
      currentDoorState: 'closed',
      targetDoorState: 'closed',
    });

    expect(mapGarageDoorState([{ name: 'core:ClosureState', value: 40 }])).toEqual({
      currentDoorState: 'stopped',
      targetDoorState: 'open',
    });

    expect(mapGarageDoorState([{ name: 'core:ClosureState', value: 70 }])).toEqual({
      currentDoorState: 'stopped',
      targetDoorState: 'closed',
    });
  });

  it('defaults to closed target when no usable state exists', () => {
    const result = mapGarageDoorState([
      { name: 'core:ClosureState', value: 'NaN' },
      { name: 'core:OpenClosedState', value: 'invalid' },
    ]);

    expect(result).toEqual({
      currentDoorState: 'stopped',
      targetDoorState: 'closed',
    });
  });
});
