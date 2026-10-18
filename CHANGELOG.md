# Changelog

All notable changes to `homebridge-lutron-pico` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 1.0.1 - 2026-10-17

### Fixed

- A hung `/device` inventory fetch no longer wedges device setup. After the
  2026-10-17 power cut, a scan started during bridge reconfiguration never
  settled, and the overlap guard silently dropped every later retry, so the
  Picos stayed dead until Homebridge was restarted. Each fetch now times out
  after 30s, and a scan requested while another is running is queued and
  re-run afterward (advancing the backoff) instead of dropped.
- An empty device inventory now counts as a failed fetch and is retried. When
  Homebridge started before the Caseta bridge after a power cut, `lutron-leap`
  swallowed the refused `/device` read and returned an empty list. The plugin
  marked the bridge as wired with no Picos, so no retry ever ran and every
  Pico stayed silent until Homebridge was restarted by hand.

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
