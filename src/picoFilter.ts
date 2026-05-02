import type { ButtonGroupDefinition } from 'lutron-leap'

export interface PicoButtonPreset {
  buttonHref: string
  presetHref: string | null
  preset: unknown
}

/**
 * A Pico is "associated" if any of its button groups has zone wiring, or any
 * of its buttons points at a Preset that has at least one assignment.
 *
 * The original plugin only checked `AffectedZones !== undefined`, which is
 * effectively always true on the wire and missed scene-bound picos entirely.
 * `ProgrammingModelType` is also useless as a discriminator: every button on
 * every Pico reports `SingleActionProgrammingModel` whether the preset is
 * programmed or not. The Preset itself is the source of truth.
 */
export function picoAssociation(
  buttonGroups: ButtonGroupDefinition[],
  buttonPresets: PicoButtonPreset[],
): { associated: true, reason: string } | { associated: false } {
  for (const bg of buttonGroups) {
    const zones = bg.AffectedZones
    if (Array.isArray(zones) && zones.length > 0) {
      return { associated: true, reason: `${bg.href} has ${zones.length} zone(s) wired` }
    }
  }
  for (const bp of buttonPresets) {
    if (presetIsProgrammed(bp.preset)) {
      return { associated: true, reason: `${bp.buttonHref} preset ${bp.presetHref} has assignments` }
    }
  }
  return { associated: false }
}

/**
 * A Preset is "programmed" if it carries any non-empty assignment array. The
 * unprogrammed shape is just `{href, Parent}`. Programmed presets carry one
 * or more of: PresetAssignments, DimmedLevelAssignments, SwitchedLevelAssignments,
 * FanSpeedAssignments, TiltAssignments, PlayPauseToggleAssignments,
 * NextTrackAssignments, FavoriteCycleAssignments, etc. We don't enumerate
 * the families - any unknown `*Assignments` array with content counts.
 */
export function presetIsProgrammed(preset: unknown): boolean {
  if (!preset || typeof preset !== 'object')
    return false
  for (const [k, v] of Object.entries(preset as Record<string, unknown>)) {
    if (k === 'href' || k === 'Parent')
      continue
    if (Array.isArray(v) && v.length > 0)
      return true
  }
  return false
}
