# Changelog

All notable changes to `homebridge-lutron-pico` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0

Initial release of the Pico-only fork of `homebridge-lutron-caseta-leap`.

### Added

- Exposes only **unassociated** Lutron Pico remotes to HomeKit as Stateless
  Programmable Switches, with one labeled button service per physical button.
- Strict association filter: a Pico is surfaced only if it is not bound to a
  zone or a programmed preset in the Lutron app (catches directly-wired and
  scene-bound Picos, including audio and fan controllers).
- Live discovery of newly paired Picos via `/device/status/deviceheard`
  subscription, with staggered inventory refreshes so new remotes appear
  without a Homebridge restart.
- Custom Homebridge UI for LEAP bridge pairing and credential entry.

### Changed

- Removed all non-Pico support (Serena blinds, occupancy sensors, the
  experimental Matter platform) from the upstream plugin.
- Simplified press detection to single-press only, eliminating the
  `Press → Release → Press` state machine that could drop presses on
  out-of-order events.
