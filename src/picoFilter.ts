import type { ButtonDefinition, ButtonGroupDefinition } from 'lutron-leap'

/**
 * A Pico is "associated" if it is bound to anything in the Lutron app:
 *   - a button group has any zone wiring (AffectedZones non-empty), or
 *   - a button carries scene/preset programming (ProgrammingModelType !== 'Unknown').
 *
 * The original plugin only checked `AffectedZones !== undefined`, which is
 * effectively always true on the wire and missed scene-bound picos entirely.
 */
export function picoAssociation(
  buttonGroups: ButtonGroupDefinition[],
  buttons: ButtonDefinition[],
): { associated: true, reason: string } | { associated: false } {
  for (const bg of buttonGroups) {
    const zones = bg.AffectedZones
    if (Array.isArray(zones) && zones.length > 0) {
      return { associated: true, reason: `${bg.href} has ${zones.length} zone(s) wired` }
    }
  }
  for (const b of buttons) {
    const pmType = b.ProgrammingModel?.ProgrammingModelType
    if (pmType && pmType !== 'Unknown') {
      return { associated: true, reason: `${b.href} has ${pmType}` }
    }
  }
  return { associated: false }
}
