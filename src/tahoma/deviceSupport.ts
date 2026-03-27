import type {
  SupportedDeviceClassification,
  SupportedDeviceKind,
  SupportedTahomaDevice,
  TahomaDevice,
  TahomaDeviceCommandMap,
} from './types.js';

function toDeviceLabel(device: TahomaDevice): string {
  return (device.label?.trim() || device.controllableName?.trim() || device.deviceURL).trim();
}

function normalizeCommandNames(device: TahomaDevice): string[] {
  const names = device.definition?.commands?.map((command) => command.commandName?.trim()).filter((name): name is string => Boolean(name));

  return names ?? [];
}

function findCommand(commandNames: string[], aliases: string[]): string | undefined {
  const lowered = commandNames.map((commandName) => ({
    commandName,
    normalized: commandName.toLowerCase(),
  }));

  for (const alias of aliases) {
    const exactMatch = lowered.find((entry) => entry.normalized === alias);
    if (exactMatch) {
      return exactMatch.commandName;
    }
  }

  for (const alias of aliases) {
    const includesMatch = lowered.find((entry) => entry.normalized.includes(alias));
    if (includesMatch) {
      return includesMatch.commandName;
    }
  }

  return undefined;
}

function detectKind(controllableName: string): SupportedDeviceKind | null {
  const normalized = controllableName.toLowerCase();

  if (normalized.includes('rollershutter')) {
    return 'rollerShutter';
  }

  if (normalized.includes('garagedoor') || normalized.includes('garage')) {
    return 'garageDoor';
  }

  return null;
}

function detectCommands(commandNames: string[]): TahomaDeviceCommandMap | null {
  const open = findCommand(commandNames, ['open']);
  const close = findCommand(commandNames, ['close']);

  if (!open || !close) {
    return null;
  }

  const stop = findCommand(commandNames, ['stop', 'my']);

  return {
    open,
    close,
    stop,
  };
}

export function classifyTahomaDevices(devices: TahomaDevice[]): SupportedDeviceClassification {
  const supported: SupportedTahomaDevice[] = [];
  const unsupported: SupportedDeviceClassification['unsupported'] = [];

  for (const device of devices) {
    if (!device.deviceURL) {
      continue;
    }

    const label = toDeviceLabel(device);
    const controllableName = device.controllableName?.trim() ?? 'unknown';
    const commandNames = normalizeCommandNames(device);
    const kind = detectKind(controllableName);

    if (!kind) {
      unsupported.push({
        deviceURL: device.deviceURL,
        label,
        controllableName,
        reason: 'Unsupported controllable type for v1 (expected RollerShutter or GarageDoor).',
      });
      continue;
    }

    const commands = detectCommands(commandNames);

    if (!commands) {
      unsupported.push({
        deviceURL: device.deviceURL,
        label,
        controllableName,
        reason: 'Missing mandatory open/close commands.',
      });
      continue;
    }

    supported.push({
      deviceURL: device.deviceURL,
      label,
      controllableName,
      kind,
      commands,
      states: device.states ?? [],
    });
  }

  return {
    supported,
    unsupported,
  };
}

export function toAccessoryDisplayName(device: SupportedTahomaDevice): string {
  return device.label || device.deviceURL;
}
