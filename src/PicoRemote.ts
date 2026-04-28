import type { PlatformAccessory, Service } from 'homebridge'
import type { ButtonDefinition, ButtonGroupDefinition, OneButtonStatusEvent, Response, SmartBridge } from 'lutron-leap'

import type { DeviceWireResult, LutronPicoPlatform } from './platform.js'

import { ExceptionDetail } from 'lutron-leap'

import { picoAssociation } from './picoFilter.js'
import { DeviceWireResultType } from './platform.js'

// DeviceType -> ButtonNumber -> human-readable label and stable order in
// Apple's Home app. Index orders the buttons top-to-bottom on the physical
// remote.
const BUTTON_MAP = new Map<string, Map<number, { label: string, index: number }>>([
  ['Pico2Button', new Map([
    [0, { label: 'On', index: 1 }],
    [2, { label: 'Off', index: 2 }],
  ])],
  ['Pico2ButtonRaiseLower', new Map([
    [0, { label: 'On', index: 1 }],
    [2, { label: 'Off', index: 4 }],
    [3, { label: 'Raise', index: 2 }],
    [4, { label: 'Lower', index: 3 }],
  ])],
  ['Pico3Button', new Map([
    [0, { label: 'On', index: 1 }],
    [1, { label: 'Center', index: 2 }],
    [2, { label: 'Off', index: 3 }],
  ])],
  ['Pico3ButtonRaiseLower', new Map([
    [0, { label: 'On', index: 1 }],
    [1, { label: 'Center', index: 3 }],
    [2, { label: 'Off', index: 5 }],
    [3, { label: 'Raise', index: 2 }],
    [4, { label: 'Lower', index: 4 }],
  ])],
  ['Pico4Button2Group', new Map([
    [1, { label: 'Group 1 On', index: 1 }],
    [2, { label: 'Group 1 Off', index: 2 }],
    [3, { label: 'Group 2 On', index: 3 }],
    [4, { label: 'Group 2 Off', index: 4 }],
  ])],
  ['Pico4ButtonScene', new Map([
    [1, { label: 'Button 1', index: 1 }],
    [2, { label: 'Button 2', index: 2 }],
    [3, { label: 'Button 3', index: 3 }],
    [4, { label: 'Button 4', index: 4 }],
  ])],
  ['Pico4ButtonZone', new Map([
    [1, { label: 'Button 1', index: 1 }],
    [2, { label: 'Button 2', index: 2 }],
    [3, { label: 'Button 3', index: 3 }],
    [4, { label: 'Button 4', index: 4 }],
  ])],
  ['PaddleSwitchPico', new Map([
    [0, { label: 'On', index: 1 }],
    [2, { label: 'Off', index: 2 }],
  ])],
])

const HANDLER_KEY_DISCONNECT = '__lpDisconnectHandler'
const HANDLER_KEY_UNSOLICITED = '__lpUnsolicitedHandler'

export class PicoRemote {
  private services: Map<string, Service> = new Map()

  constructor(
    private readonly platform: LutronPicoPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly bridge: SmartBridge,
  ) {}

  public async initialize(): Promise<DeviceWireResult> {
    const fullName = this.accessory.context.device.FullyQualifiedName.join(' ')
    const deviceType: string = this.accessory.context.device.DeviceType

    const dentry = BUTTON_MAP.get(deviceType)
    if (!dentry) {
      return { kind: DeviceWireResultType.Skipped, reason: `Pico variant ${deviceType} not yet supported` }
    }

    let rawBgs: Array<ButtonGroupDefinition | ExceptionDetail>
    try {
      rawBgs = await this.bridge.getButtonGroupsFromDevice(this.accessory.context.device)
    } catch (e) {
      return { kind: DeviceWireResultType.Error, reason: `Failed to get button groups for ${fullName}: ${e}` }
    }

    for (const bg of rawBgs) {
      if (bg instanceof ExceptionDetail) {
        return { kind: DeviceWireResultType.Skipped, reason: `${fullName}: button group has been removed` }
      }
    }
    const bgs = rawBgs as ButtonGroupDefinition[]

    let buttons: ButtonDefinition[] = []
    for (const bg of bgs) {
      try {
        buttons = buttons.concat(await this.bridge.getButtonsFromGroup(bg))
      } catch (e) {
        return { kind: DeviceWireResultType.Error, reason: `Failed to get buttons from group ${bg.href}: ${e}` }
      }
    }

    // Strict filter: any zone wiring OR any scene programming -> skip.
    const assoc = picoAssociation(bgs, buttons)
    if (assoc.associated) {
      return { kind: DeviceWireResultType.Skipped, reason: `Pico is associated in Lutron app (${assoc.reason})` }
    }

    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'Lutron Electronics Co., Inc')
      .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.accessory.context.device.ModelNumber)
      .setCharacteristic(this.platform.api.hap.Characteristic.Name, fullName)
      .setCharacteristic(this.platform.api.hap.Characteristic.ConfiguredName, fullName)
      .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, this.accessory.context.device.SerialNumber.toString())

    const labelSvc = this.accessory.getService(this.platform.api.hap.Service.ServiceLabel)
      || this.accessory.addService(this.platform.api.hap.Service.ServiceLabel)
    labelSvc.setCharacteristic(
      this.platform.api.hap.Characteristic.ServiceLabelNamespace,
      this.platform.api.hap.Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS,
    )

    for (const button of buttons) {
      const alias = dentry.get(button.ButtonNumber)
      if (alias === undefined) {
        this.platform.log.warn(`No alias for button ${button.ButtonNumber} on ${deviceType}; skipping`)
        continue
      }

      const service
        = this.accessory.getServiceById(this.platform.api.hap.Service.StatelessProgrammableSwitch, alias.label)
          || this.accessory.addService(
            this.platform.api.hap.Service.StatelessProgrammableSwitch,
            button.Name,
            alias.label,
          )

      service.addLinkedService(labelSvc)
      service.setCharacteristic(this.platform.api.hap.Characteristic.Name, alias.label)
      service.setCharacteristic(this.platform.api.hap.Characteristic.ServiceLabelIndex, alias.index)

      // Single-press only: every Press event fires SINGLE_PRESS. Maximally
      // reliable; no state machine to lose Releases.
      service.getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
        .setProps({
          maxValue: this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
          validValues: [this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS],
        })

      this.services.set(button.href, service)

      this.platform.log.debug(`Subscribing ${fullName} -> ${alias.label} (${button.href})`)
      this.bridge.subscribeToButton(button, this.handleEvent.bind(this))
    }

    // One disconnect handler per accessory. If initialize() runs again (e.g.
    // after a deviceheard refresh), we replace it instead of stacking another.
    const accAny = this.accessory as unknown as Record<string, unknown>
    const prevDisconnect = accAny[HANDLER_KEY_DISCONNECT] as ((..._args: any[]) => void) | undefined
    if (prevDisconnect) {
      this.bridge.removeListener('disconnected', prevDisconnect)
    }
    const onDisconnect = () => {
      for (const button of buttons) {
        this.platform.log.debug(`Re-subscribing ${button.href} after disconnect`)
        this.bridge.subscribeToButton(button, this.handleEvent.bind(this))
      }
    }
    this.bridge.on('disconnected', onDisconnect)
    accAny[HANDLER_KEY_DISCONNECT] = onDisconnect

    // Same idea for the platform-level unsolicited fallback.
    const prevUnsolicited = accAny[HANDLER_KEY_UNSOLICITED] as ((..._args: any[]) => void) | undefined
    if (prevUnsolicited) {
      this.platform.removeListener('unsolicited', prevUnsolicited)
    }
    const onUnsolicited = this.handleUnsolicited.bind(this)
    this.platform.on('unsolicited', onUnsolicited)
    accAny[HANDLER_KEY_UNSOLICITED] = onUnsolicited

    return { kind: DeviceWireResultType.Success, name: fullName }
  }

  private handleEvent(response: Response): void {
    const evt = (response.Body as OneButtonStatusEvent).ButtonStatus
    const action = evt.ButtonEvent.EventType

    // Only Press events fire HomeKit. Releases and LongHolds are intentionally
    // ignored - this is the maximally-reliable model.
    if (action !== 'Press') {
      return
    }

    const fullName = this.accessory.context.device.FullyQualifiedName.join(' ')
    const service = this.services.get(evt.Button.href)
    if (!service) {
      this.platform.log.warn(`Got button event for unknown href ${evt.Button.href} on ${fullName}`)
      return
    }

    this.platform.log.info(`Button press on ${fullName} (${evt.Button.href})`)
    service.getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
      .updateValue(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS)
  }

  private handleUnsolicited(response: Response): void {
    if (response.Header.MessageBodyType !== 'OneButtonStatusEvent') {
      return
    }
    const href = (response.Body as OneButtonStatusEvent)?.ButtonStatus.Button.href
    if (this.services.has(href)) {
      this.platform.log.warn(`Unsolicited event for known button ${href}; handling anyway`)
      this.handleEvent(response)
    }
  }
}
