# Claude project instructions — homebridge-lutron-pico

This is a fork of `@homebridge-plugins/homebridge-lutron-caseta-leap`. The fork dropped support for everything except Pico remotes and slimmed the codebase substantially.

## Two coexisting plugin identities

The repo has historically carried two distinct package identities on different branches. Don't conflate them.

| Identity | Package name | Class | Log signature | Where it lives |
|----------|--------------|-------|---------------|----------------|
| **Fork** (this project) | `homebridge-lutron-pico` | `LutronPicoPlatform` | `LutronPico starting up...` | `main` branch |
| **Upstream lineage** | `@homebridge-plugins/homebridge-lutron-caseta-leap` | `LutronCasetaLeap` | `LutronCasetaLeap starting up...` | upstream repo `homebridge-plugins/homebridge-lutron-caseta-leap`; this fork carries none of it now |

Both can coexist on a single Homebridge install with different platform entries in config.json (aliases `LutronPico` vs `LutronCasetaLeap`). The exact log line `[XYZ] LutronPico starting up...` is the unambiguous fingerprint that the fork is running.

## Cross-lineage merges are dangerous

A PR built on the upstream-lineage codebase **cannot be squash-merged into the fork's `main` branch** without destroying `main`. The squash merge brings the PR branch's *file states* (not just the diff) onto the base — when the two branches have diverged across hundreds of lines and dozens of files (which they have, post-fork), the merge silently replaces large swathes of the fork with upstream-lineage code, including the `package.json` `name` field. The fork can effectively disappear from `origin/main`.

**Before merging any PR into `main`:**

1. Confirm the PR branch and `main` share the same package name (`homebridge-lutron-pico`).
2. Confirm `git diff origin/main...<pr-branch> --stat` shows only the intended files. If it shows the entire codebase changing, the PR is built on the wrong base — rebase or recreate it on `main` before merging.
3. Prefer rebase over squash when the PR branch and base have any meaningful divergence beyond the PR's own commits.

Recovery from an already-corrupted `origin/main` is a force-push of the last good commit back. The "lost" PR work survives on its own branch and can be ported to the fork's actual structure as a fresh PR.

## Install path on production Homebridge hosts

The fork is **not on npm**. Installation is always from GitHub. The `prepare` script in `package.json` runs `npm run build` automatically when npm installs from a git source, so `dist/` is produced server-side.

Standard install (run as the user homebridge runs as, typically root on `hb-service`-based hosts):

```bash
export PATH=/opt/homebridge/bin:$PATH       # node/npm aren't in default PATH on hb-service hosts
cd /var/lib/homebridge
npm install --no-save --unsafe-perm github:omarshahine/homebridge-lutron-pico#main
systemctl restart homebridge
```

`--unsafe-perm` is required: without it, npm drops privileges and the `prepare` hook's `tsc` invocation fails silently, leaving the install with no `dist/`.

After install, verify the package.json on disk is the fork (not a stale leftover from a previous install of upstream content under the same directory name):

```bash
cat /var/lib/homebridge/node_modules/homebridge-lutron-pico/package.json | grep '"name"'
# Must say: "name": "homebridge-lutron-pico"
```

If it says `@homebridge-plugins/homebridge-lutron-caseta-leap`, the directory has been overwritten by a botched github install (typically because `origin/main` was corrupted at install time, or by a stale install from before the fork rename in commit `8b7b903`). Move the directory aside and reinstall.

## Diagnosing "No Response" accessories

When a Pico accessory shows "No Response" in the Home app but the bridge accessory itself is reachable, the cause is almost always: **the plugin that registered the accessory is no longer loading**. HomeKit retains the cached accessory record but the live HAP handlers are gone.

Check first:

1. `node_modules/homebridge-lutron-pico/dist/` exists (proves the build ran).
2. `node_modules/homebridge-lutron-pico/package.json` says `homebridge-lutron-pico` (proves the right code is installed).
3. Homebridge log on startup shows `[Lutron Pico] LutronPico starting up...` (proves the platform initialized).
4. Homebridge log shows `Device setup finished: Restoring Pico from cache: <Pico name>` (proves the specific accessory was re-wired).

If 1-2 pass but 3 doesn't appear, the config.json platform alias doesn't match the fork's alias (`LutronPico`).

## Working with the cabin host

The cabin Homebridge host is reachable via Tailscale at `homebridge-shahine-cabin.taila6405e.ts.net`. SSH as `root` (the `omarshahine` user is denied by tailnet ACL). Node lives at `/opt/homebridge/bin/node`. Plugins live at `/var/lib/homebridge/node_modules/`.

`homeclaw-cli search <name>` (locally on the user's mac) is the fastest way to verify accessory reachability across all Homebridge hosts — it queries HomeKit directly rather than going through the Homebridge UI.

## Clawpatch Code Review

This repo uses [Clawpatch](https://clawpatch.ai) for local automated code review. Keep `.clawpatch/` ignored; it is generated runtime state containing features, findings, reports, runs, and patch attempts.

Standard workflow:

```bash
clawpatch doctor
clawpatch init          # first time only
clawpatch map
clawpatch review --limit 10
clawpatch report --output .clawpatch/reports/summary.md
clawpatch show --finding <id>
clawpatch fix --finding <id>
clawpatch revalidate --finding <id>
```

If this repo needs hand-authored feature coverage, keep those curated definitions in `tools/clawpatch/features/` and sync/copy them into `.clawpatch/features/` before review. Do not commit `.clawpatch/` generated state.
