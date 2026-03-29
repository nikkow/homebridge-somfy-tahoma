import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import type { SomfyAccessoryContext, SomfyTahomaPlatformConfig } from './platformTypes.js';
import { SomfyTahomaAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { TahomaApiClient } from './tahoma/apiClient.js';
import { classifyTahomaDevices, toAccessoryDisplayName } from './tahoma/deviceSupport.js';

const DEFAULT_POLL_INTERVAL_SECONDS = 3;
const MIN_POLL_INTERVAL_SECONDS = 1;
const MAX_POLL_INTERVAL_SECONDS = 60;

export class SomfyTahomaPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();

  private readonly accessoryHandlers: Map<string, SomfyTahomaAccessory> = new Map();
  private readonly config: SomfyTahomaPlatformConfig;
  private syncQueue: Promise<void> = Promise.resolve();
  private pollTimer?: NodeJS.Timeout;
  private hasLoggedMissingConfig = false;

  constructor(
    public readonly log: Logging,
    rawConfig: PlatformConfig,
    public readonly api: API,
  ) {
    this.config = rawConfig as SomfyTahomaPlatformConfig;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      const pollIntervalMs = this.resolvePollingIntervalMs();
      this.log.info(`TaHoma polling interval set to ${pollIntervalMs / 1000}s.`);
      this.queueSyncWithLogging();
      this.pollTimer = setInterval(() => this.queueSyncWithLogging(), pollIntervalMs);
    });

    this.api.on('shutdown', () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  async refreshNow(): Promise<void> {
    await this.enqueueSync();
  }

  async executeDeviceCommand(deviceURL: string, commandName: string): Promise<void> {
    const client = this.createApiClient();
    await client.executeCommand(deviceURL, commandName);
  }

  private queueSyncWithLogging(): void {
    void this.enqueueSync().catch((error) => {
      this.log.error(`Failed to synchronize TaHoma devices: ${(error as Error).message}`);
    });
  }

  private enqueueSync(): Promise<void> {
    this.syncQueue = this.syncQueue
      .catch(() => undefined)
      .then(async () => this.syncDevices());

    return this.syncQueue;
  }

  private async syncDevices(): Promise<void> {
    const host = this.config.ip?.trim();
    const token = this.config.token?.trim();

    if (!host || !token) {
      if (!this.hasLoggedMissingConfig) {
        this.log.warn('TaHoma platform is not fully configured. Please set both ip and token.');
        this.hasLoggedMissingConfig = true;
      }
      return;
    }

    this.hasLoggedMissingConfig = false;

    const client = this.createApiClient();
    const allDevices = await client.getDevices();
    const classified = classifyTahomaDevices(allDevices);
    const ignoredDeviceUrls = this.getIgnoredDeviceUrls();

    if (classified.unsupported.length > 0) {
      this.log.debug(`Skipped ${classified.unsupported.length} unsupported devices.`);
    }

    const discoveredUuids = new Set<string>();
    const accessoriesToRegister: PlatformAccessory[] = [];

    for (const device of classified.supported) {
      if (ignoredDeviceUrls.has(device.deviceURL)) {
        continue;
      }

      const uuid = this.api.hap.uuid.generate(device.deviceURL);
      const context: SomfyAccessoryContext = {
        deviceURL: device.deviceURL,
        label: toAccessoryDisplayName(device),
        kind: device.kind,
        commands: device.commands,
        controllableName: device.controllableName,
      };

      discoveredUuids.add(uuid);

      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        existingAccessory.context.device = context;
        this.api.updatePlatformAccessories([existingAccessory]);

        const handler = this.ensureAccessoryHandler(uuid, existingAccessory);
        handler.updateContext(context);
        handler.updateStates(device.states);
        continue;
      }

      this.log.info('Adding new accessory:', context.label);

      const accessory = new this.api.platformAccessory(context.label, uuid);
      accessory.context.device = context;

      this.accessories.set(uuid, accessory);

      const handler = new SomfyTahomaAccessory(this, accessory);
      this.accessoryHandlers.set(uuid, handler);
      handler.updateStates(device.states);

      accessoriesToRegister.push(accessory);
    }

    if (accessoriesToRegister.length > 0) {
      this.registerAccessories(accessoriesToRegister);
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!discoveredUuids.has(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.unregisterAccessories([accessory]);
        this.accessories.delete(uuid);
        this.accessoryHandlers.delete(uuid);
      }
    }
  }

  private ensureAccessoryHandler(uuid: string, accessory: PlatformAccessory): SomfyTahomaAccessory {
    const existingHandler = this.accessoryHandlers.get(uuid);

    if (existingHandler) {
      return existingHandler;
    }

    const handler = new SomfyTahomaAccessory(this, accessory);
    this.accessoryHandlers.set(uuid, handler);

    return handler;
  }

  private getIgnoredDeviceUrls(): Set<string> {
    const ignored = Array.isArray(this.config.ignoredDeviceUrls)
      ? this.config.ignoredDeviceUrls.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];

    return new Set(ignored);
  }

  private createApiClient(): TahomaApiClient {
    return new TahomaApiClient({
      host: this.config.ip as string,
      token: this.config.token as string,
    });
  }

  private resolvePollingIntervalMs(): number {
    const configured = (this.config as { pollIntervalSeconds?: unknown }).pollIntervalSeconds;

    if (configured === undefined || configured === null) {
      return DEFAULT_POLL_INTERVAL_SECONDS * 1000;
    }

    const numericValue = typeof configured === 'number' ? configured : Number(configured);
    const isValid = Number.isInteger(numericValue)
      && numericValue >= MIN_POLL_INTERVAL_SECONDS
      && numericValue <= MAX_POLL_INTERVAL_SECONDS;

    if (!isValid) {
      this.log.warn(
        `Invalid pollIntervalSeconds value "${String(configured)}". `
        + `Using default ${DEFAULT_POLL_INTERVAL_SECONDS}s.`,
      );
      return DEFAULT_POLL_INTERVAL_SECONDS * 1000;
    }

    return numericValue * 1000;
  }

  private isKnownBridgeRaceError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.message.includes('while it was already bridged by')
      || error.message.includes('Cannot find the bridged Accessory to remove.');
  }

  private registerAccessories(accessories: PlatformAccessory[]): void {
    try {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessories);
    } catch (error) {
      if (this.isKnownBridgeRaceError(error)) {
        this.log.warn(`Ignoring duplicate accessory registration from Homebridge runtime: ${(error as Error).message}`);
      } else {
        throw error;
      }
    }

    this.api.updatePlatformAccessories(accessories);
  }

  private unregisterAccessories(accessories: PlatformAccessory[]): void {
    try {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessories);
    } catch (error) {
      if (this.isKnownBridgeRaceError(error)) {
        this.log.warn(`Ignoring duplicate accessory unregistration from Homebridge runtime: ${(error as Error).message}`);
        return;
      }

      throw error;
    }
  }
}
