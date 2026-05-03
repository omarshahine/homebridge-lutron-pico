# homebridge-lutron-pico

A Homebridge plugin that exposes Lutron Pico remotes to HomeKit. Just the Picos. Nothing else.

This is an opinionated fork of [`homebridge-lutron-caseta-leap`](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap). All the non-Pico support (Serena blinds, occupancy sensors, the experimental Matter platform) has been removed, the "is this Pico already used?" filter has been tightened, and press detection has been simplified to single-press only.

## Why this fork

I had a Caséta Smart Bridge Pro running a bunch of Picos. Some I had wired up in the Lutron app to control lights or scenes (those work fine in Lutron, I want them left alone). Others were sitting unused, ready to be wired into HomeKit automations. The upstream plugin didn't get this right for me:

1. **It surfaced Picos that were already wired in the Lutron app.** Every Pico showed up in HomeKit, including the ones controlling lights through Caséta. The upstream filter was looking at the wrong field. I'd have to disable each one by hand in the Home app.

2. **It dropped button presses.** The press detection tracked `Press → Release → Press` timing to distinguish single from double from long press. Any out-of-order event (which happens around connection blips) silently reset the state machine, and the click never reached HomeKit.

3. **It tried to do too much.** I don't have Serena blinds, I don't use the experimental Matter platform, and I'd rather have a small focused codebase that does one job well than a kitchen-sink plugin that has to keep evolving in directions I don't care about.

So I forked it and ripped out everything I didn't need.

## What's different

**Pico remotes only.** No blinds, no sensors, no Matter. If you need any of that, use the upstream plugin.

**Strict association filter.** A Pico is exposed to HomeKit only if it isn't bound to anything in the Lutron app. The plugin checks two things in the LEAP data:

- Does any of the Pico's button groups have wired zones? (the Lutron app does this when you assign a Pico to a light)
- Does any button's underlying `Preset` carry actual programming? (the Lutron app does this when you assign a Pico to a scene, audio control, fan control, etc)

If either is true, the Pico is left alone. This catches both directly-wired Picos *and* scene-bound Picos, including the audio Picos and fan controllers that the upstream filter misclassified.

**Single-press only.** Every `Press` event from the Caséta bridge fires a `SINGLE_PRESS` HomeKit event. No state machine, no timers, no race conditions on `Release`. You lose double-press and long-press detection, but you stop dropping single presses. Layer multi-press in HomeKit automations if you really need it.

## Requirements

- A **Caséta Smart Bridge Pro** (model `L-BDGPRO2-WH`). The basic Smart Bridge does not expose the LEAP API this plugin needs.
- Homebridge 1.11+ or 2.0 beta.
- Node 22 or 24.
- LEAP pairing credentials for the bridge (see Pairing below).

## What gets exposed to HomeKit

Each unassociated Pico becomes a HomeKit accessory of type **Stateless Programmable Switch**, with one labeled button service per physical button. Button labels match the printed labels on the Pico itself:

- `On`, `Off` (Pico2Button, PaddleSwitchPico)
- `On`, `Off`, `Raise`, `Lower` (Pico2ButtonRaiseLower)
- `On`, `Center`, `Off` (Pico3Button)
- `On`, `Center`, `Off`, `Raise`, `Lower` (Pico3ButtonRaiseLower)
- `Button 1` … `Button 4` (Pico4ButtonScene, Pico4ButtonZone)
- `Group 1 On/Off`, `Group 2 On/Off` (Pico4Button2Group)

Each button fires `SINGLE_PRESS` in HomeKit on every physical press. Wire it into automations, scenes, or per-button shortcuts in the Home app.

## Installation

Until I publish to npm, install from a local tarball:

```sh
git clone https://github.com/omarshahine/homebridge-lutron-pico.git
cd homebridge-lutron-pico
npm install
npm run build
npm pack
# then on your Homebridge host:
sudo -u homebridge npm install --prefix /var/lib/homebridge --omit=dev /path/to/homebridge-lutron-pico-1.0.0.tgz
sudo systemctl restart homebridge
```

Once installed, the plugin shows up in the Homebridge UI X plugin list as **Lutron Pico**.

## Configuration

Add a `LutronPico` platform stanza to your `config.json`, or use the bundled custom UI in the Homebridge UI X "Settings" panel for the plugin.

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

There are no other options. Filtering is always on. Non-Pico devices and associated Picos are always skipped.

## Pairing

Each bridge needs four pieces of info before this plugin can talk to it:

| Field | What it is | Where to get it |
| --- | --- | --- |
| `bridgeid` | The bridge's serial number, in hex | Sticker on the bottom of the Smart Bridge Pro |
| `ca` | Caséta's CA certificate | Returned by the LEAP pairing handshake |
| `key` | Your private key | Generated during pairing |
| `cert` | Your signed client certificate | Returned by the LEAP pairing handshake |

The custom UI shipped with this plugin walks you through pairing, which is essentially: press the small black button on the back of the Smart Bridge Pro, and the plugin generates a key, asks the bridge to sign it, and stores the resulting trio.

If you already paired with the upstream plugin, your existing `ca`/`key`/`cert` values transfer directly.

## Logs and diagnostics

At the **default log level**, you'll see one info line per click:

```
[Lutron Pico] Button press on Main Bedroom Pico Fan (/button/163)
```

Any of the following indicate something to investigate, all visible without flipping debug:

- `Got button event for unknown href ... press will not reach HomeKit` — a Press arrived for a button we never wired up. Smoking gun for "I clicked and nothing happened in HomeKit".
- `Failed to subscribe ...` — the per-button subscription failed at startup. The Pico is registered but its presses are silent.
- `Bridge disconnected; re-subscribing N button(s) ...` — the bridge connection dropped (briefly normal during firmware updates, sustained means a network issue).
- `Unsolicited event for known button ...; handling anyway` — the per-button subscription went stale and the event came in via the fallback path.

Flip **Homebridge Debug Mode** (UI X "Settings → Server") if you want the deeper view:

- `Subscribing <Pico> -> <button> (<href>)` — every per-button subscription at startup
- `Ignoring Release event on ...` — confirms the bridge is sending Press + Release pairs (we drop the Release on purpose)
- `Ignoring unsolicited OneZoneStatus on ...` — confirms the bridge is talking and the unsolicited fallback is filtering correctly

The combination tells you exactly where in the chain a missing press got eaten.

## What this plugin does NOT do

- **Serena tilt-only wood blinds.** Use upstream.
- **Occupancy sensors.** Use upstream.
- **Matter platform.** Use upstream.
- **Double press, long press, hold-and-release.** Single press only, by design.
- **Picos already programmed in the Lutron app.** Always skipped.
- **Non-LEAP bridges.** The basic Caséta Smart Bridge will not work.

## Development

```sh
npm install
npm run build      # tsc + copy plugin UI
npm test           # vitest
npm run lint
```

The filter logic lives in `src/picoFilter.ts` with unit tests in `src/picoFilter.test.ts`. The bridge / device / button wiring lives in `src/PicoRemote.ts` and `src/platform.ts`.

## Credits

All the heavy LEAP-protocol lifting comes from [`lutron-leap-js`](https://github.com/thenewwazoo/lutron-leap-js). The original [`homebridge-lutron-caseta-leap`](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap) maintainers wrote everything this fork is based on. This is just a stripped-down opinionated rewrite of two narrow pieces (the association filter and the press detection) on top of their work.

## Trademarks

Lutron, Caséta, and Pico are trademarks of Lutron Electronics Co., Inc. This project is not affiliated with, endorsed by, or sponsored by Lutron.

## License

Apache-2.0 (inherited from the upstream project).
