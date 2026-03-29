<p align="center">
  <img src="https://raw.githubusercontent.com/homebridge/branding/latest/logos/homebridge-color-round.png" width="75" alt="Homebridge logo" />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/somfy-logo.png" width="200" alt="Somfy logo" />
</p>

# Homebridge Somfy TaHoma

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=nikkow_homebridge-somfy-tahoma&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=nikkow_homebridge-somfy-tahoma)
[![npm](https://img.shields.io/npm/v/homebridge-somfy-tahoma.svg)](https://www.npmjs.com/package/homebridge-somfy-tahoma)
[![npm](https://img.shields.io/npm/dt/homebridge-somfy-tahoma.svg)](https://www.npmjs.com/package/homebridge-somfy-tahoma)
![license](https://img.shields.io/github/license/nikkow/homebridge-somfy-tahoma.svg)
![code size](https://img.shields.io/github/languages/code-size/nikkow/homebridge-somfy-tahoma)

Control your Somfy TaHoma gateway locally from Homebridge and expose supported devices to Apple Home.

## Important note

This plugin is based on Somfy local API access (Developer Mode).  
Homebridge must run on the same local network as your TaHoma gateway.

Good news: once local access is configured, device control stays local.

## Why this plugin?

This plugin talks directly to your TaHoma box on your local network.

- No cloud dependency for normal control
- Fast local updates in HomeKit
- Guided setup from the Homebridge UI
- Automatic discovery of compatible TaHoma gateways

## Compatibility

Current v1 support:

| Device type | HomeKit service | Status |
| --- | --- | --- |
| IO/HomeControl roller shutters | `WindowCovering` | ✅ Supported |
| IO/HomeControl garage doors | `GarageDoorOpener` | ✅ Supported |
| Other TaHoma device families | N/A | 🚫 Not supported yet |

## Prerequisites

- Homebridge `^1.8.0` or `^2.0.0-beta.0`
- Node.js `^20.18.0` or `^22.10.0` or `^24.0.0`
- A Somfy TaHoma gateway on the same local network as Homebridge
- Developer Mode enabled on the gateway
- A valid TaHoma developer token

## Quick Start

1. Install this plugin from the Homebridge UI.
2. Open plugin settings for `Somfy TaHoma`.
3. Enable Developer Mode in the TaHoma app (tap gateway PIN 7 times).
4. Generate a developer token in the app and copy it.
5. In the setup wizard:
   - Discover your gateway (or enter host/IP manually)
   - Paste the token
   - Validate connection
   - Optionally ignore specific devices
6. Save configuration and restart Homebridge if requested.

## Configuration

Minimal `config.json` platform block:

```json
{
  "platform": "SomfyTaHoma",
  "name": "Somfy TaHoma",
  "ip": "192.168.1.100",
  "token": "paste-token-generated-in-tahoma-app",
  "pollIntervalSeconds": 3,
  "ignoredDeviceUrls": []
}
```

Notes:

- `ip` accepts IP, hostname, or HTTPS host format.
- Default gateway port is `8443`.
- `pollIntervalSeconds` is optional and controls sync frequency (integer `1..60`, default `3`).
- `ignoredDeviceUrls` keeps selected devices out of HomeKit.

## What happens at runtime?

- The plugin syncs devices using `pollIntervalSeconds` (default: 3 seconds).
- New supported devices are added automatically.
- Removed devices are cleaned from Homebridge cache.
- Unsupported devices are skipped (debug logs explain why).

## Security

- Local API calls use HTTPS.
- TLS is validated with Somfy/Overkiz CA roots.
- If needed, the plugin retries with peer certificate fingerprint pinning.

## Troubleshooting

If nothing appears in HomeKit:

1. Verify Homebridge and TaHoma are on the same LAN.
2. Re-check Developer Mode is enabled.
3. Regenerate a token and paste it again.
4. Use the wizard validation step and review unsupported devices.
5. Enable Homebridge debug logs to see classification and API errors.

## Disclaimer

> [!CAUTION]
> This software is provided as-is. It can control real devices (doors, shutters). Use it carefully.

## Development

```bash
npm install
npm run lint
npm run build
npm run watch
```

- `npm run watch` builds, links the plugin, and runs a development loop with automatic restarts.

## License

Apache-2.0
