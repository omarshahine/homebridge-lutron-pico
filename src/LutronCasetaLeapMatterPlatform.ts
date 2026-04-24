// Type for Matter-required fields
// Matter device type IDs (see CSA Device Library)
import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge'
import type { DeviceDefinition, SmartBridge } from 'lutron-leap'

import { DeviceWireResultType, LutronCasetaLeap } from './platform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

interface MatterAccessoryFields {
  deviceType: number[]
  manufacturer: string
  model: string
  serialNumber: string
}

enum MatterDeviceType {
  RemoteControl = 0x0016,
  // Add more as needed
}

/**
 * Homebridge Matter platform for the Lutron Caseta LEAP plugin.
 *
 * Extends the standard HAP platform ({@link LutronCasetaLeap}) and overrides
 * accessory registration to use the Homebridge Matter API when it is
 * available.  If the Matter API is absent at runtime the class falls back
 * transparently to the standard HAP behaviour inherited from
 * {@link LutronCasetaLeap}.
 *
 * Note: `configureAccessory` is intentionally **not** overridden here so that
 * cached accessories restored by Homebridge continue to be stored in
 * `this.accessories` via the base-class implementation.
 */
export class LutronCasetaLeapMatterPlatform extends LutronCasetaLeap {
  constructor(log: Logging, config: PlatformConfig, api: API) {
    super(log, config, api)
    log.info('LutronCasetaLeapMatterPlatform: Matter mode active')
  }

  /**
   * Returns the Homebridge Matter sub-API if both `registerPlatformAccessories`
   * and `unregisterPlatformAccessories` are present, or `undefined` otherwise.
   */
  private get matterApi(): any | undefined {
    const anyApi = this.api as any
    if (
      anyApi?.matter
      && typeof anyApi.matter.registerPlatformAccessories === 'function'
      && typeof anyApi.matter.unregisterPlatformAccessories === 'function'
    ) {
      return anyApi.matter
    }
    return undefined
  }

  /**
   * Overrides {@link LutronCasetaLeap.processDevice} to register newly
   * discovered accessories with the Matter API when available, falling back
   * to the standard HAP path when Matter is not present.
   */
  override async processDevice(
    bridge: SmartBridge,
    d: DeviceDefinition,
  ): Promise<string> {
    const mApi = this.matterApi
    if (!mApi) {
      // Matter API not present – delegate entirely to the HAP implementation.
      return super.processDevice(bridge, d)
    }

    const fullName = d.FullyQualifiedName.join(' ')
    const uuid = this.api.hap.uuid.generate(d.SerialNumber.toString())

    let accessory: PlatformAccessory | undefined = this.accessories.get(uuid)
    let isFromCache = true
    if (accessory === undefined) {
      isFromCache = false
      // Use the PlatformAccessory constructor from the API
      const PlatformAccessoryCtor = this.api.platformAccessory as unknown as { new(name: string, uuid: string): PlatformAccessory }
      accessory = new PlatformAccessoryCtor(fullName, uuid)
      this.log.debug(`Device ${fullName} not found in accessory cache (Matter mode)`)
    }

    const result = await this.wireAccessory(accessory, bridge, d)
    accessory.displayName = fullName

    // Set all required Matter fields before registration
    let matterFields: MatterAccessoryFields | undefined
    if (typeof d.DeviceType === 'string' && d.DeviceType.toLowerCase().includes('pico')) {
      matterFields = {
        deviceType: [MatterDeviceType.RemoteControl],
        manufacturer: 'Lutron Electronics',
        model: (d.ModelNumber || d.DeviceType || 'Pico Remote').toString(),
        serialNumber: d.SerialNumber?.toString() || uuid,
      }
      // Use PicoRemote to generate clusters and wire up Matter event emission
      const PicoRemote = (await import('./PicoRemote.js')).PicoRemote
      // Pass mApi and accessory for event emission
      const pico = new PicoRemote(this, accessory, bridge, {} as any, mApi)
      const clusters = pico.getMatterClusters()
      // Deeply remove accidental 'behaviors' property from clusters, accessory, and context
      function deepDeleteBehaviors(obj: any) {
        if (!obj || typeof obj !== 'object') {
          return
        }
        if ('behaviors' in obj) {
          delete obj.behaviors
        }
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'object' && obj[key] !== null) {
            deepDeleteBehaviors(obj[key])
          }
        }
      }
      deepDeleteBehaviors(clusters);
      (accessory as any).clusters = clusters
      accessory.context.clusters = clusters
      deepDeleteBehaviors(accessory)
      deepDeleteBehaviors(accessory.context)

      // Homebridge Matter API does not support setClusterHandler; only set clusters on accessory/context
    }
    // Add more device type mappings as needed, using MatterDeviceType enum

    if (matterFields) {
      // Set on both the accessory and its context for maximum compatibility
      Object.assign(accessory, matterFields)
      Object.assign(accessory.context, matterFields)
    }

    switch (result.kind) {
      case DeviceWireResultType.Error: {
        if (isFromCache) {
          mApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
          this.log.debug(`un-registered cached device ${fullName} (Matter) due to an error: ${result.reason}`)
        }
        return Promise.reject(new Error(`Failed to wire device ${fullName}: ${result.reason}`))
      }
      case DeviceWireResultType.Skipped: {
        if (isFromCache) {
          this.log.debug(`un-registered cached device ${fullName} (Matter) because it was skipped`)
          mApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
        }
        return Promise.resolve(`Skipped setting up device: ${result.reason}`)
      }
      case DeviceWireResultType.Success: {
        if (!isFromCache) {
          this.accessories.set(accessory.UUID, accessory)
          mApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
          this.log.debug(`registered new device ${fullName} (Matter) because it was new`)
        }
        return Promise.resolve(isFromCache
          ? `Restoring existing accessory from cache (Matter): ${fullName}`
          : `Adding new accessory (Matter): ${fullName}`)
      }
    }
  }
}
