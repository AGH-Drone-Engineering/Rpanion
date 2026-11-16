import { describe, test, expect } from 'vitest'
import {
  WPA_TYPES,
  BAND_TYPES,
  DEFAULT_SUBNET,
  DEFAULT_SERVER_IP,
  filterConnectionsForDevice,
  resolveSelectedConnection,
  pickDefaultDevice,
  toFormSettings,
  channelsForBand,
  makeNewConModal,
  applyNewConChange,
  applyScannedWifi,
  applyHotspot,
  applyManualWifi,
  validateNewConnection,
  toNewConSettings,
  isSystemProfile,
  isFallbackProfile,
  isValidIPv4
} from './networkModel.js'

const wlan0 = { value: 'wlan0', type: 'wifi', channels: [
  { value: '0', label: 'Auto', band: 0 },
  { value: '1', label: '1', band: 'bg' },
  { value: '36', label: '36', band: 'a' }
] }
const eth0 = { value: 'eth0', type: 'ethernet' }
const tun0 = { value: 'tun0', type: 'tun' }

const con = (over) => ({ value: 'uuid', labelPre: 'X', type: '802-11-wireless', state: '', attachedIface: '', role: null, label: '', ...over })

describe('constants', () => {
  test('wpa and band types', () => {
    expect(WPA_TYPES.map(t => t.value)).toEqual(['none', 'wpa-psk'])
    expect(BAND_TYPES.map(t => t.value)).toEqual(['a', 'bg'])
    expect(DEFAULT_SUBNET).toBe('255.255.255.0')
    expect(DEFAULT_SERVER_IP).toBe('10.0.3.1')
  })
})

describe('filterConnectionsForDevice', () => {
  const connections = [
    con({ value: 'ap', labelPre: 'WiFiAP', role: 'wifi-ap' }),
    con({ value: 'home', labelPre: 'Home', state: 'wlan0' }),
    con({ value: 'other-if', labelPre: 'Other', attachedIface: 'wlan1' }),
    con({ value: 'quoted', labelPre: 'Quoted', attachedIface: '""' }),
    con({ value: 'srv', labelPre: 'Ethernet-Server', type: '802-3-ethernet', role: 'ethernet-server' }),
    con({ value: 'cli', labelPre: 'Ethernet-Client', type: '802-3-ethernet', role: 'ethernet-client', state: 'eth0' }),
    con({ value: 'wired', labelPre: 'Wired', type: '802-3-ethernet', attachedIface: 'eth0' }),
    con({ value: 'vpn', labelPre: 'VPN', type: 'tun', state: 'tun0' })
  ]

  test('wifi device: wireless profiles for that adapter, system profiles last', () => {
    const res = filterConnectionsForDevice(connections, wlan0)
    expect(res.map(c => c.value)).toEqual(['home', 'quoted', 'ap'])
    expect(res[0]).toMatchObject({ label: 'Home (Active)', isActive: true })
    expect(res[1]).toMatchObject({ label: 'Quoted', isActive: false })
  })

  test('ethernet device: client first, server last', () => {
    const res = filterConnectionsForDevice(connections, eth0)
    expect(res.map(c => c.value)).toEqual(['cli', 'wired', 'srv'])
    expect(res[0].label).toBe('Ethernet-Client (Active)')
  })

  test('other device types use tun profiles', () => {
    const res = filterConnectionsForDevice(connections, tun0)
    expect(res.map(c => c.value)).toEqual(['vpn'])
  })

  test('does not mutate input', () => {
    const snapshot = JSON.parse(JSON.stringify(connections))
    const res = filterConnectionsForDevice(connections, wlan0)
    expect(connections).toEqual(snapshot)
    expect(res[0]).not.toBe(connections[1])
  })

  test('no device or no connections', () => {
    expect(filterConnectionsForDevice(connections, null)).toEqual([])
    expect(filterConnectionsForDevice(undefined, wlan0)).toEqual([])
  })
})

describe('resolveSelectedConnection', () => {
  const list = [con({ value: 'a' }), con({ value: 'b', isActive: true }), con({ value: 'c' })]
  test('keeps an existing selection', () => {
    expect(resolveSelectedConnection(list, 'c').value).toBe('c')
  })
  test('falls back to active, then first', () => {
    expect(resolveSelectedConnection(list, 'gone').value).toBe('b')
    expect(resolveSelectedConnection([con({ value: 'a' })], null).value).toBe('a')
    expect(resolveSelectedConnection([], null)).toBeNull()
  })
})

describe('toFormSettings', () => {
  test('maps details to form fields', () => {
    const res = toFormSettings({ DHCP: 'manual', IP: '1.2.3.4', subnet: '255.0.0.0', wpaType: 'wpa-psk', password: 'secret12',
      ssid: 'net', band: 'bg', channel: '6', mode: 'infrastructure', attachedIface: 'wlan0', priority: 0 })
    expect(res).toEqual({ ipaddresstype: 'manual', ipaddress: '1.2.3.4', subnet: '255.0.0.0', wpaType: 'wpa-psk', password: 'secret12',
      ssid: 'net', band: 'bg', channel: '6', mode: 'infrastructure', attachedIface: 'wlan0', priority: 0 })
  })
  test('missing values become empty strings', () => {
    const res = toFormSettings({})
    expect(Object.values(res).every(v => v === '')).toBe(true)
    expect(toFormSettings(undefined).priority).toBe('')
  })
})

describe('channelsForBand', () => {
  test('returns band channels plus band-independent ones', () => {
    expect(channelsForBand(wlan0, 'bg').map(c => c.value)).toEqual(['0', '1'])
    expect(channelsForBand(wlan0, 'a').map(c => c.value)).toEqual(['0', '36'])
    expect(channelsForBand(eth0, 'a')).toEqual([])
    expect(channelsForBand(null, 'a')).toEqual([])
  })
})

describe('new connection draft', () => {
  test('wifi starts at the select step', () => {
    expect(makeNewConModal('wifi')).toMatchObject({ conType: 'wifi', step: 'select', mode: 'infrastructure', wpaType: 'wpa-psk', band: 'bg', priority: 100 })
  })
  test('wired starts at the configure step', () => {
    expect(makeNewConModal('ethernet')).toMatchObject({ conType: 'ethernet', step: 'configure', conName: 'Ethernet-Custom', wpaType: 'none', mode: '', ipaddresstype: 'auto', priority: 100 })
  })
  test('returns a fresh object each call', () => {
    expect(makeNewConModal('wifi')).not.toBe(makeNewConModal('wifi'))
  })

  test('priority is stored as a number', () => {
    const d = applyNewConChange(makeNewConModal('ethernet'), 'priority', '42')
    expect(d.priority).toBe(42)
    expect(applyNewConChange(d, 'priority', '').priority).toBe('')
  })

  test('switching to DHCP server fills defaults and lowers default priority', () => {
    const d = applyNewConChange(makeNewConModal('ethernet'), 'ipaddresstype', 'shared')
    expect(d).toMatchObject({ ipaddress: DEFAULT_SERVER_IP, subnet: DEFAULT_SUBNET, priority: 50 })
    expect(applyNewConChange(d, 'ipaddresstype', 'auto').priority).toBe(100)
  })

  test('typed priority 100 is lowered like the default', () => {
    const typed = applyNewConChange(makeNewConModal('ethernet'), 'priority', '100')
    expect(applyNewConChange(typed, 'ipaddresstype', 'shared').priority).toBe(50)
  })

  test('scanned network presets', () => {
    expect(applyScannedWifi(makeNewConModal('wifi'), 'Home', 'WPA2')).toMatchObject({ step: 'configure', ssid: 'Home', conName: 'Home', wpaType: 'wpa-psk' })
    expect(applyScannedWifi(makeNewConModal('wifi'), 'Cafe', 'Open').wpaType).toBe('none')
    expect(applyScannedWifi(makeNewConModal('wifi'), 'Cafe', '').wpaType).toBe('none')
  })

  test('hotspot and manual presets', () => {
    expect(applyHotspot(makeNewConModal('wifi'))).toMatchObject({ mode: 'ap', conName: 'WiFiAP', ssid: 'rpanion', ipaddresstype: 'shared', ipaddress: '10.0.2.100', priority: 0 })
    expect(applyManualWifi(makeNewConModal('wifi'))).toMatchObject({ mode: 'infrastructure', conName: 'WiFi-Client', ssid: '', step: 'configure' })
  })

  test('validation', () => {
    const base = applyManualWifi(makeNewConModal('wifi'))
    expect(validateNewConnection({ ...base, conName: ' ' })).toMatch(/name/)
    expect(validateNewConnection({ ...base, ssid: '' })).toMatch(/SSID/)
    expect(validateNewConnection({ ...base, ssid: 'x', password: 'short' })).toMatch(/8 and 63/)
    expect(validateNewConnection({ ...base, ssid: 'x', password: 'longenough' })).toBeNull()
    const wired = { ...makeNewConModal('ethernet'), ipaddresstype: 'manual', ipaddress: '' }
    expect(validateNewConnection(wired)).toMatch(/required/)
  })

  test('settings sent to the server do not include attachedIface', () => {
    const s = toNewConSettings({ ...applyManualWifi(makeNewConModal('wifi')), ssid: 'x', password: 'longenough' })
    expect(s).not.toHaveProperty('attachedIface')
    expect(s).toMatchObject({ ssid: 'x', password: 'longenough', mode: 'infrastructure', priority: 100 })
  })
})

describe('profile roles', () => {
  test('isSystemProfile uses role', () => {
    expect(isSystemProfile({ role: 'wifi-ap' })).toBe(true)
    expect(isSystemProfile({ role: 'ethernet-client' })).toBe(true)
    expect(isSystemProfile({ role: null, labelPre: 'WiFiAP' })).toBe(false)
    expect(isSystemProfile(null)).toBe(false)
  })
  test('isFallbackProfile excludes the default client', () => {
    expect(isFallbackProfile({ role: 'ethernet-server' })).toBe(true)
    expect(isFallbackProfile({ role: 'wifi-ap' })).toBe(true)
    expect(isFallbackProfile({ role: 'ethernet-client' })).toBe(false)
  })
})

describe('isValidIPv4', () => {
  test('accepts dotted quads within range', () => {
    expect(isValidIPv4('192.168.1.10')).toBe(true)
    expect(isValidIPv4('255.255.255.0')).toBe(true)
  })
  test('rejects octets above 255 and malformed input', () => {
    expect(isValidIPv4('192.168.1.256')).toBe(false)
    expect(isValidIPv4('999.1.1.1')).toBe(false)
    expect(isValidIPv4('1.2.3')).toBe(false)
    expect(isValidIPv4('')).toBe(false)
    expect(isValidIPv4(undefined)).toBe(false)
  })
})

describe('pickDefaultDevice', () => {
  test('keeps the current adapter while it exists', () => {
    expect(pickDefaultDevice([eth0, wlan0], 'eth0')).toBe('eth0')
  })
  test('prefers wifi, then the first adapter', () => {
    expect(pickDefaultDevice([eth0, wlan0], 'gone')).toBe('wlan0')
    expect(pickDefaultDevice([eth0, tun0], null)).toBe('eth0')
    expect(pickDefaultDevice([], null)).toBeNull()
  })
})
