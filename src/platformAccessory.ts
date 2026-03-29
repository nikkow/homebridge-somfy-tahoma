import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { SomfyTahomaPlatform } from './platform.js';
import type { SomfyAccessoryContext } from './platformTypes.js';
import { mapGarageDoorState, mapRollerShutterState } from './tahoma/stateMapper.js';
import type { TahomaState } from './tahoma/types.js';

export class SomfyTahomaAccessory {
  private service: Service;
  private context: SomfyAccessoryContext;

  private rollerCurrentPosition = 0;
  private rollerTargetPosition = 0;
  private rollerPositionState: CharacteristicValue;

  private garageCurrentDoorState: CharacteristicValue;
  private garageTargetDoorState: CharacteristicValue;

  constructor(
    private readonly platform: SomfyTahomaPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.context = accessory.context.device as SomfyAccessoryContext;
    this.rollerPositionState = this.platform.Characteristic.PositionState.STOPPED;
    this.garageCurrentDoorState = this.platform.Characteristic.CurrentDoorState.STOPPED;
    this.garageTargetDoorState = this.platform.Characteristic.TargetDoorState.CLOSED;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Somfy')
      .setCharacteristic(this.platform.Characteristic.Model, this.context.controllableName ?? this.context.kind)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.context.deviceURL);

    this.service = this.ensureService();
    this.configureHandlers();
  }

  updateContext(context: SomfyAccessoryContext): void {
    this.context = context;
    this.accessory.context.device = context;
    this.service = this.ensureService();
    this.configureHandlers();
  }

  updateStates(states: TahomaState[]): void {
    if (this.context.kind === 'rollerShutter') {
      const mapped = mapRollerShutterState(states);

      this.rollerCurrentPosition = mapped.currentPosition;
      this.rollerTargetPosition = mapped.targetPosition;
      this.rollerPositionState = this.platform.Characteristic.PositionState.STOPPED;

      if (mapped.positionState === 'increasing') {
        this.rollerPositionState = this.platform.Characteristic.PositionState.INCREASING;
      } else if (mapped.positionState === 'decreasing') {
        this.rollerPositionState = this.platform.Characteristic.PositionState.DECREASING;
      }

      this.service
        .updateCharacteristic(this.platform.Characteristic.CurrentPosition, this.rollerCurrentPosition)
        .updateCharacteristic(this.platform.Characteristic.TargetPosition, this.rollerTargetPosition)
        .updateCharacteristic(this.platform.Characteristic.PositionState, this.rollerPositionState);

      return;
    }

    const mapped = mapGarageDoorState(states);
    this.garageCurrentDoorState = this.toGarageCurrentDoorState(mapped.currentDoorState);
    this.garageTargetDoorState = this.toGarageTargetDoorState(mapped.targetDoorState);

    this.service
      .updateCharacteristic(this.platform.Characteristic.CurrentDoorState, this.garageCurrentDoorState)
      .updateCharacteristic(this.platform.Characteristic.TargetDoorState, this.garageTargetDoorState)
      .updateCharacteristic(this.platform.Characteristic.ObstructionDetected, false);
  }

  private ensureService(): Service {
    const isRoller = this.context.kind === 'rollerShutter';

    const staleService = isRoller
      ? this.accessory.getService(this.platform.Service.GarageDoorOpener)
      : this.accessory.getService(this.platform.Service.WindowCovering);

    if (staleService) {
      this.accessory.removeService(staleService);
    }

    const service = isRoller
      ? this.accessory.getService(this.platform.Service.WindowCovering) || this.accessory.addService(this.platform.Service.WindowCovering)
      : this.accessory.getService(this.platform.Service.GarageDoorOpener) || this.accessory.addService(this.platform.Service.GarageDoorOpener);

    service.setCharacteristic(this.platform.Characteristic.Name, this.context.label);

    return service;
  }

  private configureHandlers(): void {
    if (this.context.kind === 'rollerShutter') {
      this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition)
        .onGet(async () => this.rollerCurrentPosition);

      this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)
        .onGet(async () => this.rollerTargetPosition)
        .onSet(this.setRollerTargetPosition.bind(this));

      this.service.getCharacteristic(this.platform.Characteristic.PositionState)
        .onGet(async () => this.rollerPositionState);

      return;
    }

    this.service.getCharacteristic(this.platform.Characteristic.CurrentDoorState)
      .onGet(async () => this.garageCurrentDoorState);

    this.service.getCharacteristic(this.platform.Characteristic.TargetDoorState)
      .onGet(async () => this.garageTargetDoorState)
      .onSet(this.setGarageTargetDoorState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.ObstructionDetected)
      .onGet(async () => false);
  }

  private async setRollerTargetPosition(value: CharacteristicValue): Promise<void> {
    const targetPosition = typeof value === 'number' ? value : Number(value);
    const shouldOpen = targetPosition > 0;

    this.rollerTargetPosition = shouldOpen ? 100 : 0;
    this.rollerPositionState = shouldOpen
      ? this.platform.Characteristic.PositionState.INCREASING
      : this.platform.Characteristic.PositionState.DECREASING;

    this.service
      .updateCharacteristic(this.platform.Characteristic.TargetPosition, this.rollerTargetPosition)
      .updateCharacteristic(this.platform.Characteristic.PositionState, this.rollerPositionState);

    try {
      await this.platform.executeDeviceCommand(this.context.deviceURL, shouldOpen ? this.context.commands.open : this.context.commands.close);
      await this.platform.refreshNow();
    } catch (error) {
      this.platform.log.error(`Failed to execute roller command for ${this.context.label}: ${(error as Error).message}`);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async setGarageTargetDoorState(value: CharacteristicValue): Promise<void> {
    const target = typeof value === 'number' ? value : Number(value);
    const shouldOpen = target === this.platform.Characteristic.TargetDoorState.OPEN;

    this.garageTargetDoorState = shouldOpen
      ? this.platform.Characteristic.TargetDoorState.OPEN
      : this.platform.Characteristic.TargetDoorState.CLOSED;

    this.garageCurrentDoorState = shouldOpen
      ? this.platform.Characteristic.CurrentDoorState.OPENING
      : this.platform.Characteristic.CurrentDoorState.CLOSING;

    this.service
      .updateCharacteristic(this.platform.Characteristic.TargetDoorState, this.garageTargetDoorState)
      .updateCharacteristic(this.platform.Characteristic.CurrentDoorState, this.garageCurrentDoorState);

    try {
      await this.platform.executeDeviceCommand(this.context.deviceURL, shouldOpen ? this.context.commands.open : this.context.commands.close);
      await this.platform.refreshNow();
    } catch (error) {
      this.platform.log.error(`Failed to execute garage command for ${this.context.label}: ${(error as Error).message}`);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private toGarageCurrentDoorState(value: 'open' | 'closed' | 'opening' | 'closing' | 'stopped'): CharacteristicValue {
    if (value === 'open') {
      return this.platform.Characteristic.CurrentDoorState.OPEN;
    }

    if (value === 'closed') {
      return this.platform.Characteristic.CurrentDoorState.CLOSED;
    }

    if (value === 'opening') {
      return this.platform.Characteristic.CurrentDoorState.OPENING;
    }

    if (value === 'closing') {
      return this.platform.Characteristic.CurrentDoorState.CLOSING;
    }

    return this.platform.Characteristic.CurrentDoorState.STOPPED;
  }

  private toGarageTargetDoorState(value: 'open' | 'closed'): CharacteristicValue {
    return value === 'open'
      ? this.platform.Characteristic.TargetDoorState.OPEN
      : this.platform.Characteristic.TargetDoorState.CLOSED;
  }
}
