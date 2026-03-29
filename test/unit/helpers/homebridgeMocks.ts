import { vi } from 'vitest';

type CharacteristicGetter = () => unknown | Promise<unknown>;
type CharacteristicSetter = (value: unknown) => unknown | Promise<unknown>;

export class FakeCharacteristicController {
  private onGetHandler: CharacteristicGetter = () => undefined;
  private onSetHandler: CharacteristicSetter = () => undefined;

  onGet(handler: CharacteristicGetter): this {
    this.onGetHandler = handler;
    return this;
  }

  onSet(handler: CharacteristicSetter): this {
    this.onSetHandler = handler;
    return this;
  }

  async triggerGet(): Promise<unknown> {
    return this.onGetHandler();
  }

  async triggerSet(value: unknown): Promise<unknown> {
    return this.onSetHandler(value);
  }
}

export class FakeService {
  public readonly characteristicValues = new Map<unknown, unknown>();
  public readonly characteristicControllers = new Map<unknown, FakeCharacteristicController>();

  constructor(public readonly type: string) {}

  setCharacteristic(characteristic: unknown, value: unknown): this {
    this.characteristicValues.set(characteristic, value);
    return this;
  }

  updateCharacteristic(characteristic: unknown, value: unknown): this {
    this.characteristicValues.set(characteristic, value);
    return this;
  }

  getCharacteristic(characteristic: unknown): FakeCharacteristicController {
    const existing = this.characteristicControllers.get(characteristic);

    if (existing) {
      return existing;
    }

    const created = new FakeCharacteristicController();
    this.characteristicControllers.set(characteristic, created);

    return created;
  }

  getValue(characteristic: unknown): unknown {
    return this.characteristicValues.get(characteristic);
  }
}

export class FakePlatformAccessory {
  public readonly context: Record<string, unknown> = {};
  private readonly services = new Map<string, FakeService>();

  constructor(
    public readonly displayName: string,
    public readonly UUID: string,
  ) {
    this.services.set('AccessoryInformation', new FakeService('AccessoryInformation'));
  }

  getService(serviceType: string): FakeService | undefined {
    return this.services.get(serviceType);
  }

  addService(serviceType: string): FakeService {
    const service = new FakeService(serviceType);
    this.services.set(serviceType, service);
    return service;
  }

  removeService(service: FakeService): void {
    for (const [key, value] of this.services.entries()) {
      if (value === service) {
        this.services.delete(key);
        return;
      }
    }
  }

  hasService(serviceType: string): boolean {
    return this.services.has(serviceType);
  }
}

export function createMockHap() {
  const Service = {
    AccessoryInformation: 'AccessoryInformation',
    WindowCovering: 'WindowCovering',
    GarageDoorOpener: 'GarageDoorOpener',
  } as const;

  const Characteristic = {
    Manufacturer: 'Manufacturer',
    Model: 'Model',
    SerialNumber: 'SerialNumber',
    Name: 'Name',
    CurrentPosition: 'CurrentPosition',
    TargetPosition: 'TargetPosition',
    PositionState: {
      DECREASING: 0,
      INCREASING: 1,
      STOPPED: 2,
    },
    CurrentDoorState: {
      OPEN: 0,
      CLOSED: 1,
      OPENING: 2,
      CLOSING: 3,
      STOPPED: 4,
    },
    TargetDoorState: {
      OPEN: 0,
      CLOSED: 1,
    },
    ObstructionDetected: 'ObstructionDetected',
  } as const;

  class HapStatusError extends Error {
    constructor(public readonly hapStatus: number) {
      super(`HAP status ${hapStatus}`);
      this.name = 'HapStatusError';
    }
  }

  return {
    Service,
    Characteristic,
    HAPStatus: {
      SERVICE_COMMUNICATION_FAILURE: -70402,
    },
    HapStatusError,
    uuid: {
      generate: vi.fn((input: string) => `uuid-${input}`),
    },
  };
}

export function createMockHomebridgeApi() {
  const hap = createMockHap();
  const listeners = new Map<string, Array<() => void>>();

  class PlatformAccessoryImpl extends FakePlatformAccessory {}

  const api = {
    hap,
    platformAccessory: PlatformAccessoryImpl,
    on: vi.fn((event: string, callback: () => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(callback);
      listeners.set(event, existing);
    }),
    registerPlatformAccessories: vi.fn(),
    updatePlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
  };

  const emit = (event: string): void => {
    for (const listener of listeners.get(event) ?? []) {
      listener();
    }
  };

  return {
    api,
    hap,
    emit,
  };
}

export function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
