import type { PlatformConfig } from 'homebridge';

import type { SupportedDeviceKind, TahomaDeviceCommandMap } from './tahoma/types.js';

export interface SomfyTahomaPlatformConfig extends PlatformConfig {
  ip?: string;
  token?: string;
  pollIntervalSeconds?: number;
  ignoredDeviceUrls?: string[];
}

export interface SomfyAccessoryContext {
  deviceURL: string;
  label: string;
  kind: SupportedDeviceKind;
  commands: TahomaDeviceCommandMap;
  controllableName?: string;
}
