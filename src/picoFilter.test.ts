import type { ButtonDefinition, ButtonGroupDefinition } from 'lutron-leap'

import { describe, expect, it } from 'vitest'

import { picoAssociation } from './picoFilter.js'

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

function btn(opts: Partial<ButtonDefinition> = {}): ButtonDefinition {
  return {
    href: '/button/1',
    AssociatedLED: { href: '/led/1' },
    ButtonNumber: 0,
    Engraving: { Text: '' },
    Name: 'Button 1',
    Parent: { href: '/device/1' },
    ProgrammingModel: {
      href: '/programmingmodel/1',
      ProgrammingModelType: 'Unknown',
    } as any,
    ...opts,
  } as ButtonDefinition
}

describe('picoAssociation', () => {
  it('reports unassociated when nothing is wired', () => {
    const result = picoAssociation([bg()], [btn(), btn({ href: '/button/2' })])
    expect(result.associated).toBe(false)
  })

  it('detects zone wiring', () => {
    const wiredBg = bg({ AffectedZones: [{ href: '/zone/1' }] as any })
    const result = picoAssociation([wiredBg], [btn()])
    expect(result.associated).toBe(true)
    if (result.associated) {
      expect(result.reason).toContain('zone(s) wired')
    }
  })

  it('ignores empty AffectedZones array (the upstream bug)', () => {
    // Upstream check was `AffectedZones !== undefined`, which is true even
    // when empty. The strict filter must treat [] as unassociated.
    const result = picoAssociation([bg({ AffectedZones: [] })], [btn()])
    expect(result.associated).toBe(false)
  })

  it('detects scene/preset programming on a button', () => {
    const sceneBtn = btn({
      ProgrammingModel: {
        href: '/programmingmodel/2',
        ProgrammingModelType: 'SingleActionProgrammingModel',
      } as any,
    })
    const result = picoAssociation([bg()], [sceneBtn])
    expect(result.associated).toBe(true)
    if (result.associated) {
      expect(result.reason).toContain('SingleActionProgrammingModel')
    }
  })

  it('detects dual-action programming', () => {
    const dualBtn = btn({
      ProgrammingModel: {
        href: '/programmingmodel/3',
        ProgrammingModelType: 'DualActionProgrammingModel',
      } as any,
    })
    expect(picoAssociation([bg()], [dualBtn]).associated).toBe(true)
  })

  it('treats ProgrammingModelType === "Unknown" as unassociated', () => {
    const result = picoAssociation([bg()], [btn(), btn({ href: '/button/2' })])
    expect(result.associated).toBe(false)
  })

  it('treats missing ProgrammingModel as unassociated', () => {
    const noPmBtn = btn({ ProgrammingModel: undefined as any })
    const result = picoAssociation([bg()], [noPmBtn])
    expect(result.associated).toBe(false)
  })

  it('zone wiring takes precedence over per-button programming check order', () => {
    const wiredBg = bg({ AffectedZones: [{ href: '/zone/1' }, { href: '/zone/2' }] as any })
    const sceneBtn = btn({
      ProgrammingModel: { href: '/p/1', ProgrammingModelType: 'SingleActionProgrammingModel' } as any,
    })
    const result = picoAssociation([wiredBg], [sceneBtn])
    expect(result.associated).toBe(true)
    if (result.associated) {
      expect(result.reason).toContain('zone(s) wired')
    }
  })
})
