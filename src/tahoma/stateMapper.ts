import type { TahomaState } from './types.js';

export interface RollerStateSnapshot {
  currentPosition: number;
  targetPosition: number;
  positionState: 'increasing' | 'decreasing' | 'stopped';
}

export interface GarageStateSnapshot {
  currentDoorState: 'open' | 'closed' | 'opening' | 'closing' | 'stopped';
  targetDoorState: 'open' | 'closed';
}

function clampPercentage(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function findState(states: TahomaState[], names: string[]): TahomaState | undefined {
  const wanted = new Set(names.map((name) => name.toLowerCase()));

  return states.find((state) => wanted.has(state.name.toLowerCase()));
}

function getNumericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value.toLowerCase() : undefined;
}

export function mapRollerShutterState(states: TahomaState[]): RollerStateSnapshot {
  const closureState = findState(states, ['core:ClosureState', 'core:TargetClosureState']);
  const openClosedState = findState(states, ['core:OpenClosedState']);
  const movingState = findState(states, ['core:MovingState']);

  const closurePercentage = getNumericValue(closureState?.value);
  const openClosed = getStringValue(openClosedState?.value);
  const moving = getStringValue(movingState?.value);

  let currentPosition = 0;

  if (closurePercentage !== undefined) {
    // Somfy closure = 0 open / 100 closed, HomeKit = 0 closed / 100 open.
    currentPosition = clampPercentage(100 - closurePercentage);
  } else if (openClosed === 'open') {
    currentPosition = 100;
  }

  let positionState: RollerStateSnapshot['positionState'] = 'stopped';

  if (moving === 'up' || moving === 'opening') {
    positionState = 'increasing';
  } else if (moving === 'down' || moving === 'closing') {
    positionState = 'decreasing';
  } else if (openClosed === 'opening') {
    positionState = 'increasing';
  } else if (openClosed === 'closing') {
    positionState = 'decreasing';
  }

  let targetPosition = currentPosition;

  if (positionState === 'increasing') {
    targetPosition = 100;
  } else if (positionState === 'decreasing') {
    targetPosition = 0;
  }

  return {
    currentPosition,
    targetPosition,
    positionState,
  };
}

export function mapGarageDoorState(states: TahomaState[]): GarageStateSnapshot {
  const openClosedState = findState(states, ['core:OpenClosedState']);
  const closureState = findState(states, ['core:ClosureState']);

  const openClosed = getStringValue(openClosedState?.value);
  const closurePercentage = getNumericValue(closureState?.value);

  if (openClosed === 'open') {
    return {
      currentDoorState: 'open',
      targetDoorState: 'open',
    };
  }

  if (openClosed === 'closed') {
    return {
      currentDoorState: 'closed',
      targetDoorState: 'closed',
    };
  }

  if (openClosed === 'opening') {
    return {
      currentDoorState: 'opening',
      targetDoorState: 'open',
    };
  }

  if (openClosed === 'closing') {
    return {
      currentDoorState: 'closing',
      targetDoorState: 'closed',
    };
  }

  if (closurePercentage !== undefined) {
    const normalized = clampPercentage(closurePercentage);

    if (normalized <= 10) {
      return {
        currentDoorState: 'open',
        targetDoorState: 'open',
      };
    }

    if (normalized >= 90) {
      return {
        currentDoorState: 'closed',
        targetDoorState: 'closed',
      };
    }

    return {
      currentDoorState: 'stopped',
      targetDoorState: normalized > 50 ? 'closed' : 'open',
    };
  }

  return {
    currentDoorState: 'stopped',
    targetDoorState: 'closed',
  };
}
