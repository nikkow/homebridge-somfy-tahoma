# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-30

### Added
- First stable release of `homebridge-somfy-tahoma`.

### Changed
- Promoted the local Somfy TaHoma integration from beta to stable.
- Kept the v1 scope focused on roller shutters and garage doors with HomeKit mapping.

### Notes
- Requires TaHoma Developer Mode and local network access between Homebridge and the gateway.

## [0.1.2-beta.0] - 2026-03-29

### Added
- First public beta release of `homebridge-somfy-tahoma`.
- Local Somfy TaHoma integration through the local API (Developer Mode), without cloud dependency for normal control.
- Initial device support for:
  - IO/HomeControl roller shutters (`WindowCovering` in HomeKit).
  - IO/HomeControl garage doors (`GarageDoorOpener` in HomeKit).
- Homebridge UI setup wizard with:
  - mDNS gateway discovery (`kizbox` services),
  - manual host/IP fallback,
  - token input and API validation,
  - supported vs unsupported device preview,
  - ignored device selection.
- Configurable polling interval (`pollIntervalSeconds`, range `1..60`, default `3`).

### Known Limitations
- Only roller shutters and garage doors are supported in v1.
- TaHoma Developer Mode must be enabled, and Homebridge must run on the same local network.
