import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge'
import type {
  BridgeNetInfo,
  DeviceDefinition,
  OneDeviceStatus,
  Response,
} from 'lutron-leap'
import type TypedEmitter from 'typed-emitter'

import { EventEmitter } from 'node:events'
import process from 'node:process'

import { APIEvent } from 'homebridge'
import {
  BridgeFinder,
  LEAP_PORT,
  LeapClient,
  SmartBridge,
} from 'lutron-leap'

import { PicoRemote } from './PicoRemote.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

interface PlatformEvents {
  [event: string]: (...args: any[]) => void
  unsolicited: (response: Response) => void
}

interface BridgeAuthEntry {
  bridgeid: string
  ca: string
  key: string
  cert: string
}

export enum DeviceWireResultType {
  Success,
  Skipped,
  Error,
}

export type DeviceWireResult =
  | { kind: DeviceWireResultType.Success, name: string }
  | { kind: DeviceWireResultType.Skipped, reason: string }
  | { kind: DeviceWireResultType.Error, reason: string }

const PICO_DEVICE_TYPES = new Set([
  'Pico2Button',
  'Pico2ButtonRaiseLower',
  'Pico3Button',
  'Pico3ButtonRaiseLower',
  'Pico4Button2Group',
  'Pico4ButtonScene',
  'Pico4ButtonZone',
  'PaddleSwitchPico',
])

export class LutronPicoPlatform
  extends (EventEmitter as new () => TypedEmitter<PlatformEvents>)
  implements DynamicPlatformPlugin {
  public readonly accessories: Map<string, PlatformAccessory> = new Map()
  private finder: BridgeFinder | null = null
  private secrets: Map<string, BridgeAuthEntry>
  private bridgeMgr: Map<string, SmartBridge> = new Map()

  constructor(public readonly log: Logging, public readonly config: PlatformConfig, public readonly api: API) {
    super()

    log.info('LutronPico starting up...')

    process.on('warning', e => this.log.warn(`Got ${e.name} process warning: ${e.message}:\n${e.stack}`))

    this.secrets = this.secretsFromConfig(config)
    if (this.secrets.size === 0) {
      log.warn('No bridge auth configured. Retiring.')
      return
    }

    // Each pico subscribes to platform-level 'unsolicited'. Allow plenty of headroom.
    this.setMaxListeners(400 * this.secrets.size)

    api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      log.info('Finished launching; starting up automatic discovery')

      this.finder = new BridgeFinder()
      this.finder.on('discovered', this.handleBridgeDiscovery.bind(this))
      this.finder.on('failed', (error) => {
        log.error('Could not connect to discovered hub:', error)
      })
      this.finder.beginSearching()
    })

    log.info('LutronPico plugin finished early initialization')
  }

  private secretsFromConfig(config: PlatformConfig): Map<string, BridgeAuthEntry> {
    const out = new Map<string, BridgeAuthEntry>()
    for (const entry of (config.secrets as Array<BridgeAuthEntry> | undefined) ?? []) {
      out.set(entry.bridgeid.toLowerCase(), {
        ca: entry.ca,
        key: entry.key,
        cert: entry.cert,
        bridgeid: entry.bridgeid,
      })
    }
    return out
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory)
  }

  // ----- private bridge / device handling -----

  private async handleBridgeDiscovery(bridgeInfo: BridgeNetInfo) {
    let replaceClient = false
    const bridgeID = bridgeInfo.bridgeid.toLowerCase()

    if (this.bridgeMgr.has(bridgeID)) {
      if (this.bridgeMgr.get(bridgeID)!.bridgeReconfigInProgress === true) {
        this.log.info('Bridge', bridgeInfo.bridgeid, 'reconfiguration in progress; skipping.')
        return
      }
      this.log.info('Bridge', bridgeInfo.bridgeid, 'already known; reusing connection.')
      replaceClient = true
    }

    if (!this.secrets.has(bridgeID)) {
      this.log.info('No credentials for bridge', bridgeInfo.bridgeid)
      return
    }

    const these = this.secrets.get(bridgeID)!
    const client = new LeapClient(bridgeInfo.ipAddr, LEAP_PORT, these.ca, these.key, these.cert)

    if (replaceClient) {
      this.log.info('Bridge', bridgeInfo.bridgeid, 'entering reconfiguration')
      await this.bridgeMgr.get(bridgeID)!.reconfigureBridge(client)
      this.log.info('Bridge', bridgeInfo.bridgeid, 'exit reconfiguration')
    } else {
      const bridge = new SmartBridge(bridgeID, client)
      bridge.setMaxListeners(400)
      this.bridgeMgr.set(bridge.bridgeID, bridge)
      this.processAllDevices(bridge)
    }
  }

  private processAllDevices(bridge: SmartBridge) {
    bridge.getDeviceInfo().then(async (devices: DeviceDefinition[]) => {
      const results = await Promise.allSettled(
        devices.map(device => this.processDevice(bridge, device)),
      )
      for (const result of results) {
        if (result.status === 'fulfilled') {
          this.log.info(`Device setup finished: ${result.value}`)
        } else {
          this.log.error(`Failed to process device: ${result.reason}`)
        }
      }
    }).catch((error) => {
      this.log.warn('Failed to fetch device inventory; skipping this scan:', error)
    })

    bridge.on('unsolicited', this.handleUnsolicitedMessage.bind(this))
  }

  private async processDevice(bridge: SmartBridge, d: DeviceDefinition): Promise<string> {
    const fullName = d.FullyQualifiedName.join(' ')

    if (!PICO_DEVICE_TYPES.has(d.DeviceType)) {
      this.log.debug(`Ignoring non-Pico device: ${fullName} (${d.DeviceType})`)
      return `Ignored non-Pico: ${fullName}`
    }

    const uuid = this.api.hap.uuid.generate(d.SerialNumber.toString())
    let accessory = this.accessories.get(uuid)
    let isFromCache = true

    if (accessory === undefined) {
      isFromCache = false
      accessory = new this.api.platformAccessory(fullName, uuid)
      this.log.debug(`Pico ${fullName} not in accessory cache`)
    }

    accessory.context.device = d
    accessory.context.bridgeID = bridge.bridgeID
    accessory.displayName = fullName

    const remote = new PicoRemote(this, accessory, bridge)
    const result = await remote.initialize()

    switch (result.kind) {
      case DeviceWireResultType.Error: {
        if (isFromCache) {
          this.log.warn(`Could not refresh ${fullName}; leaving cached accessory: ${result.reason}`)
          return `Leaving cached accessory: ${fullName}`
        }
        throw new Error(`Failed to wire ${fullName}: ${result.reason}`)
      }
      case DeviceWireResultType.Skipped: {
        if (isFromCache) {
          this.log.info(`Removing previously-registered Pico that no longer qualifies: ${fullName} (${result.reason})`)
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
          this.accessories.delete(accessory.UUID)
        }
        return `Skipped Pico ${fullName}: ${result.reason}`
      }
      case DeviceWireResultType.Success: {
        if (!isFromCache) {
          this.accessories.set(accessory.UUID, accessory)
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
          return `Adding new Pico: ${fullName}`
        }
        return `Restoring Pico from cache: ${fullName}`
      }
    }
  }

  private handleUnsolicitedMessage(bridgeID: string, response: Response) {
    if (response.CommuniqueType === 'UpdateResponse' && response.Header.Url === '/device/status/deviceheard') {
      const heardDevice = (response.Body! as OneDeviceStatus).DeviceStatus.DeviceHeard
      this.log.info(`New ${heardDevice.DeviceType} s/n ${heardDevice.SerialNumber}. Triggering refresh in 30s.`)
      const bridge = this.bridgeMgr.get(bridgeID)
      if (bridge !== undefined) {
        setTimeout(() => this.processAllDevices(bridge), 30000)
      }
    } else {
      this.emit('unsolicited', response)
    }
  }
}
