/* global console, process, setTimeout */

import bonjour from 'bonjour';

function normalizeType(rawType) {
  const value = String(rawType).trim();

  if (!value) {
    return 'kizboxdev';
  }

  if (value.includes('._')) {
    const parts = value.split('.');
    const first = parts.find((entry) => entry.length > 0);
    return first ? first.replace(/^_+/, '') : 'kizboxdev';
  }

  return value.replace(/^_+/, '');
}

function parseArgs(argv) {
  const args = {
    timeoutMs: 30000,
    typePrefix: 'kizbox',
    protocol: 'tcp',
    all: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--timeout' && argv[index + 1]) {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed >= 1000) {
        args.timeoutMs = parsed;
      }
      index += 1;
      continue;
    }

    if (value === '--type' && argv[index + 1]) {
      args.typePrefix = normalizeType(argv[index + 1]);
      index += 1;
      continue;
    }

    if (value === '--type-prefix' && argv[index + 1]) {
      args.typePrefix = normalizeType(argv[index + 1]);
      index += 1;
      continue;
    }

    if (value === '--protocol' && argv[index + 1]) {
      args.protocol = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === '--all') {
      args.all = true;
      continue;
    }

    if (value === '--help' || value === '-h') {
      console.log('Usage: node test-bonjour.js [--all] [--timeout 5000] [--type-prefix kizbox] [--protocol tcp]');
      process.exit(0);
    }
  }

  if (args.all) {
    args.typePrefix = undefined;
    args.protocol = undefined;
  }

  return args;
}

function normalizeService(service) {
  const host = service.addresses?.[0] || service.host || 'unknown-host';
  const port = service.port || 0;
  const txt = service.txt || {};

  return {
    name: service.name,
    type: service.type,
    protocol: service.protocol,
    host,
    port,
    addresses: service.addresses || [],
    txt: {
      gateway_pin: txt.gateway_pin || null,
      api_version: txt.api_version || null,
      fw_version: txt.fw_version || null,
      raw: txt,
    },
  };
}

function matchesFilter(service, options) {
  if (options.all) {
    return true;
  }

  const serviceType = typeof service.type === 'string' ? service.type.toLowerCase() : '';
  const wantedPrefix = typeof options.typePrefix === 'string' ? options.typePrefix.toLowerCase() : '';

  console.log(`[bonjour-test] Checking service type: ${serviceType} against prefix: ${wantedPrefix}`);

  if (wantedPrefix && !serviceType.startsWith(wantedPrefix)) {
    return false;
  }

  const serviceProtocol = typeof service.protocol === 'string' ? service.protocol.toLowerCase() : '';
  const wantedProtocol = typeof options.protocol === 'string' ? options.protocol.toLowerCase() : '';

  if (wantedProtocol && serviceProtocol !== wantedProtocol) {
    return false;
  }

  return true;
}

const options = parseArgs(process.argv.slice(2));

const modeLabel = options.all
  ? 'all services (wildcard)'
  : `type startsWith(${options.typePrefix}) protocol=${options.protocol}`;

console.log(`[bonjour-test] Discovering ${modeLabel} for ${options.timeoutMs}ms`);

const instance = bonjour();
const browser = instance.find({});

const discovered = new Map();
let closed = false;

function stopAndExit(exitCode) {
  if (closed) {
    return;
  }

  closed = true;

  browser.stop();
  instance.destroy();

  const list = [...discovered.values()];

  console.log(`\n[bonjour-test] Discovery finished: ${list.length} service(s)`);

  if (list.length > 0) {
    console.log(JSON.stringify(list, null, 2));
  }

  process.exit(exitCode);
}

process.on('uncaughtException', (error) => {
  console.error(`\n[bonjour-test] Fatal error: ${error.message}`);
  stopAndExit(1);
});

process.on('unhandledRejection', (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[bonjour-test] Unhandled rejection: ${message}`);
  stopAndExit(1);
});

browser.on('up', (service) => {
  if (!matchesFilter(service, options)) {
    return;
  }

  const normalized = normalizeService(service);
  const key = `${normalized.host}:${normalized.port}:${normalized.name}`;

  if (!discovered.has(key)) {
    discovered.set(key, normalized);
    console.log(`[bonjour-test] UP ${normalized.name} @ ${normalized.host}:${normalized.port}`);
  }
});

browser.on('down', (service) => {
  console.log(`[bonjour-test] DOWN ${service.name} @ ${service.host}:${service.port}`);
});

setTimeout(() => {
  stopAndExit(0);
}, options.timeoutMs);

process.on('SIGINT', () => {
  console.log('\n[bonjour-test] Interrupted (SIGINT)');
  stopAndExit(130);
});

process.on('SIGTERM', () => {
  console.log('\n[bonjour-test] Interrupted (SIGTERM)');
  stopAndExit(143);
});
