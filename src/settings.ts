import type { PlatformConfig } from 'homebridge'

export const PLUGIN_NAME = 'homebridge-lutron-pico'
export const PLATFORM_NAME = 'LutronPico'

export interface LutronPicoPluginConfig extends PlatformConfig {
  secrets?: Array<{
    bridgeid: string
    ca: string
    key: string
    cert: string
  }>
}
