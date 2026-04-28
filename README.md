# homebridge-lutron-pico

A focused Homebridge plugin that exposes **only** Lutron Pico remotes to HomeKit — and **only** the picos that are not already wired to anything in the Lutron Caséta app.

Forked from [`homebridge-lutron-caseta-leap`](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap). Everything not related to Pico remotes (Serena blinds, occupancy sensors, the experimental Matter platform) has been ripped out, the association filter has been tightened, and press detection has been simplified to single-press only for maximum reliability.

## Why this fork?

I had two recurring problems with the upstream plugin:

1. **HomeKit duplicates.** Picos that I had already configured in the Lutron app (controlling lights, dimmers, scenes) still showed up in HomeKit, requiring me to manually disable each one. The upstream filter only checked `AffectedZones !== undefined`, which is effectively always true on the wire even for empty arrays, and never caught picos bound to scenes via `ProgrammingModel`.

2. **Missed button presses.** The press state machine occasionally dropped clicks, especially after a connection blip. The upstream plugin tries to detect single / double / long presses by tracking `Press → Release → Press` timing, and any out-of-order event would silently reset the state machine.

This fork solves both:

- **Strict association filter.** A Pico is only exposed to HomeKit if every button group has zero `AffectedZones` **and** every button has `ProgrammingModelType === 'Unknown'`. If you've wired a button to anything in the Lutron app, the plugin leaves it alone.
- **Single-press only.** Every `Press` event from the bridge fires a `SINGLE_PRESS` HomeKit event. No state machine, no timers, no missed clicks. You lose double / long press, but you can layer those on top in HomeKit automations if you really need them — and you stop dropping single presses, which is what mattered most.

## Supported Pico variants

- Pico2Button
- Pico2ButtonRaiseLower
- Pico3Button
- Pico3ButtonRaiseLower
- Pico4Button2Group
- Pico4ButtonScene
- Pico4ButtonZone
- PaddleSwitchPico

## Installation

```sh
npm install -g homebridge-lutron-pico
```

Then add the platform via the Homebridge config UI. The plugin uses the same `LEAP` pairing flow as the upstream plugin — the bundled custom UI walks you through associating each bridge.

## Configuration

```json
{
  "platforms": [
    {
      "platform": "LutronPico",
      "name": "Lutron Pico",
      "secrets": [
        {
          "bridgeid": "ABCDEF12",
          "ca": "-----BEGIN CERTIFICATE-----...",
          "key": "-----BEGIN PRIVATE KEY-----...",
          "cert": "-----BEGIN CERTIFICATE-----..."
        }
      ]
    }
  ]
}
```

There are no other options. Filter behavior is always-on; non-Pico devices and associated picos are always skipped.

## Credits

All the heavy LEAP-protocol lifting comes from [`lutron-leap-js`](https://github.com/thenewwazoo/lutron-leap-js) and the original [`homebridge-lutron-caseta-leap`](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap) maintainers. This is just a stripped-down opinionated fork.

## License

Apache-2.0 (inherited from the upstream project).
