import type { API, Logging, PlatformConfig } from 'homebridge'

import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDeviceInfo = vi.fn()
const reconfigureBridge = vi.fn().mockResolvedValue(undefined)
const subscribe = vi.fn().mockResolvedValue(undefined)

class FakeSmartBridge extends EventEmitter {
  public bridgeReconfigInProgress = false
  public client = { subscribe }
  constructor(public bridgeID: string) {
    super()
  }

  getDeviceInfo = getDeviceInfo
  reconfigureBridge = reconfigureBridge
}

vi.mock('lutron-leap', () => ({
  BridgeFinder: class extends EventEmitter {
    beginSearching = vi.fn()
  },
  LEAP_PORT: 8081,
  LeapClient: class {},
  SmartBridge: FakeSmartBridge,
}))

const { LutronPicoPlatform } = await import('./platform.js')

const BRIDGE_ID = '04783583'

function makePlatform() {
  const log = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as Logging

  const config = {
    platform: 'LutronPico',
    secrets: [{ bridgeid: BRIDGE_ID, ca: 'ca', cert: 'cert', key: 'key' }],
  } as unknown as PlatformConfig

  const api = {
    hap: { uuid: { generate: (s: string) => s } },
    on: vi.fn(),
    platformAccessory: class {},
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
  } as unknown as API

  return new LutronPicoPlatform(log, config, api) as any
}

const bridgeInfo = { bridgeid: BRIDGE_ID, ipAddr: '192.168.1.175' } as any

describe('bridge rediscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reconfigureBridge.mockResolvedValue(undefined)
    subscribe.mockResolvedValue(undefined)
  })

  // Regression: a bridge that is still booting (site-wide power cut, Homebridge
  // up before the Caseta bridge) rejects the first inventory fetch. Before the
  // fix, rediscovery only re-pointed the socket and never re-wired accessories,
  // so every Pico stayed dead until Homebridge was restarted by hand.
  it('re-runs device setup when the first inventory fetch failed', async () => {
    getDeviceInfo
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 192.168.1.175:8081'))
      .mockResolvedValue([])

    const platform = makePlatform()

    await platform.handleBridgeDiscovery(bridgeInfo)
    await vi.waitFor(() => expect(getDeviceInfo).toHaveBeenCalledTimes(1))

    await platform.handleBridgeDiscovery(bridgeInfo)
    await vi.waitFor(() => expect(getDeviceInfo).toHaveBeenCalledTimes(2))
  })

  // Recovery must not depend on the bridge re-announcing itself over mDNS.
  it('retries device setup on a timer after the inventory fetch fails', async () => {
    vi.useFakeTimers()
    try {
      getDeviceInfo
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED 192.168.1.175:8081'))
        .mockResolvedValue([])

      const platform = makePlatform()

      await platform.handleBridgeDiscovery(bridgeInfo)
      await vi.waitFor(() => expect(getDeviceInfo).toHaveBeenCalledTimes(1))

      await vi.advanceTimersByTimeAsync(10_000)
      expect(getDeviceInfo).toHaveBeenCalledTimes(2)

      // Wired now, so the chain stops instead of retrying forever.
      await vi.advanceTimersByTimeAsync(600_000)
      expect(getDeviceInfo).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  // mDNS re-announces every 12-18s in the field, which is well inside the time
  // it takes to wire a full inventory. processDevice awaits PicoRemote setup
  // between checking the accessory cache and registering, so two overlapping
  // scans would each treat a new Pico as unregistered and register it twice.
  it('does not start an overlapping scan while device setup is still running', async () => {
    let releaseInventory: (devices: unknown[]) => void = () => {}
    getDeviceInfo.mockReturnValueOnce(new Promise((resolve) => {
      releaseInventory = resolve
    }))

    const platform = makePlatform()

    await platform.handleBridgeDiscovery(bridgeInfo)
    await vi.waitFor(() => expect(getDeviceInfo).toHaveBeenCalledTimes(1))

    // Rediscovery lands while the first inventory fetch is still outstanding.
    await platform.handleBridgeDiscovery(bridgeInfo)
    expect(getDeviceInfo).toHaveBeenCalledTimes(1)

    releaseInventory([])
    await vi.waitFor(() => expect(reconfigureBridge).toHaveBeenCalledTimes(1))
    expect(getDeviceInfo).toHaveBeenCalledTimes(1)
  })

  it('does not re-run device setup when the bridge is already wired', async () => {
    getDeviceInfo.mockResolvedValue([])

    const platform = makePlatform()

    await platform.handleBridgeDiscovery(bridgeInfo)
    await vi.waitFor(() => expect(getDeviceInfo).toHaveBeenCalledTimes(1))

    await platform.handleBridgeDiscovery(bridgeInfo)
    await vi.waitFor(() => expect(reconfigureBridge).toHaveBeenCalledTimes(1))
    expect(getDeviceInfo).toHaveBeenCalledTimes(1)
  })
})
