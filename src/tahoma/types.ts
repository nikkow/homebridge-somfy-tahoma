export interface TahomaState {
  name: string;
  value?: unknown;
  type?: number;
}

export interface TahomaCommandDefinition {
  commandName?: string;
}

export interface TahomaDeviceDefinition {
  commands?: TahomaCommandDefinition[];
}

export interface TahomaDevice {
  deviceURL: string;
  label?: string;
  controllableName?: string;
  definition?: TahomaDeviceDefinition;
  states?: TahomaState[];
  available?: boolean;
  enabled?: boolean;
}

export type SupportedDeviceKind = 'garageDoor' | 'rollerShutter';

export interface TahomaDeviceCommandMap {
  open: string;
  close: string;
  stop?: string;
}

export interface SupportedTahomaDevice {
  deviceURL: string;
  label: string;
  controllableName: string;
  kind: SupportedDeviceKind;
  commands: TahomaDeviceCommandMap;
  states: TahomaState[];
}

export interface UnsupportedTahomaDevice {
  deviceURL: string;
  label: string;
  controllableName: string;
  reason: string;
}

export interface SupportedDeviceClassification {
  supported: SupportedTahomaDevice[];
  unsupported: UnsupportedTahomaDevice[];
}

export interface TahomaDiscoveryResult {
  name: string;
  host: string;
  port: number;
  gatewayPin?: string;
  apiVersion?: string;
  fwVersion?: string;
}
