import type { ButtonGroupDefinition } from 'lutron-leap'

import { describe, expect, it } from 'vitest'

import { picoAssociation, presetIsProgrammed } from './picoFilter.js'

function bg(opts: Partial<ButtonGroupDefinition> = {}): ButtonGroupDefinition {
  return {
    href: '/buttongroup/1',
    AffectedZones: [],
    Buttons: [],
    Parent: {} as any,
    ProgrammingType: 'Column',
    SortOrder: 0,
    StopIfMoving: 'Disabled',
    ...opts,
  } as ButtonGroupDefinition
}

function bp(opts: { buttonHref?: string, presetHref?: string | null, preset: unknown }) {
  return {
    buttonHref: opts.buttonHref ?? '/button/1',
    presetHref: opts.presetHref ?? '/preset/1',
    preset: opts.preset,
  }
}

describe('presetIsProgrammed', () => {
  it('treats the empty Preset shell as not programmed', () => {
    expect(presetIsProgrammed({ href: '/preset/1', Parent: { href: '/programmingmodel/1' } })).toBe(false)
  })

  it('treats null/undefined/non-object as not programmed', () => {
    expect(presetIsProgrammed(null)).toBe(false)
    expect(presetIsProgrammed(undefined)).toBe(false)
    expect(presetIsProgrammed('preset')).toBe(false)
    expect(presetIsProgrammed(42)).toBe(false)
  })

  it('treats empty assignment arrays as not programmed', () => {
    expect(presetIsProgrammed({ href: '/p/1', Parent: { href: '/pm/1' }, PresetAssignments: [] })).toBe(false)
  })

  it('detects scene-style PresetAssignments', () => {
    expect(presetIsProgrammed({
      href: '/p/1',
      Parent: { href: '/pm/1' },
      PresetAssignments: [{ href: '/presetassignment/1' }],
      DimmedLevelAssignments: [{ href: '/dimmedlevelassignment/1' }],
    })).toBe(true)
  })

  it('detects audio-Pico Preset families (PlayPauseToggle, NextTrack, FavoriteCycle)', () => {
    expect(presetIsProgrammed({
      href: '/p/1',
      Parent: { href: '/pm/1' },
      PlayPauseToggleAssignments: [{ href: '/playpausetoggleassignment/1' }],
    })).toBe(true)
    expect(presetIsProgrammed({
      href: '/p/1',
      Parent: { href: '/pm/1' },
      NextTrackAssignments: [{ href: '/nexttrackassignment/3' }],
    })).toBe(true)
    expect(presetIsProgrammed({
      href: '/p/1',
      Parent: { href: '/pm/1' },
      FavoriteCycleAssignments: [{ href: '/favoritecycleassignment/2' }],
    })).toBe(true)
  })

  it('detects unknown future *Assignments families generically', () => {
    expect(presetIsProgrammed({
      href: '/p/1',
      Parent: { href: '/pm/1' },
      ImaginaryFutureAssignments: [{ href: '/imaginary/1' }],
    })).toBe(true)
  })
})

describe('picoAssociation', () => {
  it('reports unassociated when nothing is wired and all presets are empty', () => {
    const empty = { href: '/preset/1', Parent: { href: '/pm/1' } }
    const result = picoAssociation([bg()], [bp({ preset: empty })])
    expect(result.associated).toBe(false)
  })

  it('detects zone wiring without needing to look at presets', () => {
    const wiredBg = bg({ AffectedZones: [{ href: '/zone/1' }] as any })
    const result = picoAssociation([wiredBg], [])
    expect(result.associated).toBe(true)
    if (result.associated)
      expect(result.reason).toContain('zone(s) wired')
  })

  it('ignores empty AffectedZones arrays (the upstream bug)', () => {
    const result = picoAssociation([bg({ AffectedZones: [] })], [])
    expect(result.associated).toBe(false)
  })

  it('detects programmed presets even with no zone wiring', () => {
    const programmed = {
      href: '/preset/173',
      Parent: { href: '/pm/164' },
      PresetAssignments: [{ href: '/presetassignment/50' }],
    }
    const result = picoAssociation([bg()], [bp({ buttonHref: '/button/130', presetHref: '/preset/173', preset: programmed })])
    expect(result.associated).toBe(true)
    if (result.associated) {
      expect(result.reason).toContain('/button/130')
      expect(result.reason).toContain('/preset/173')
    }
  })

  it('zone wiring takes precedence over preset check', () => {
    const wiredBg = bg({ AffectedZones: [{ href: '/zone/1' }, { href: '/zone/2' }] as any })
    const programmed = { href: '/preset/1', Parent: {}, PresetAssignments: [{ href: '/x' }] }
    const result = picoAssociation([wiredBg], [bp({ preset: programmed })])
    expect(result.associated).toBe(true)
    if (result.associated)
      expect(result.reason).toContain('zone(s) wired')
  })

  it('treats null preset entries (fetch failed) as not programmed', () => {
    const result = picoAssociation([bg()], [bp({ preset: null })])
    expect(result.associated).toBe(false)
  })
})
