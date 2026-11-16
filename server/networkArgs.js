const { toSubnet } = require('./ipv4Subnet')
const { parseTerseRow } = require('./nmcli')

/*
 * Pure helpers that translate between NetworkManager/iw output and the
 * settings used by networkManager.js. No process execution here.
 */

// Parses `iw list` / `iw phy` frequency lines such as
// "* 2412.0 MHz [1] (20.0 dBm)". Disabled channels are skipped and
// duplicates (several phys) are removed.
function parseIwChannels (iwText) {
  const channels = []
  const seen = new Set()
  for (const line of iwText.split('\n')) {
    const match = line.trim().match(/^\*\s+([\d.]+)\s+MHz\s+\[(\d+)\](.*)$/)
    if (!match || /\(disabled\)/.test(match[3])) continue
    const value = parseInt(match[2], 10)
    if (seen.has(value)) continue
    seen.add(value)
    channels.push({
      value,
      freq: match[1],
      label: `${value} (${match[1]} MHz)`,
      band: parseFloat(match[1]) < 3000 ? 'bg' : 'a'
    })
  }
  return channels
}

/**
 * IPv4 properties for `nmcli connection add|modify`.
 * Access points always use shared mode with a /24 (dnsmasq DHCP range).
 * @param {object} conSettings {mode, ipaddresstype, ipaddress, subnet}
 * @param {{isNew?: boolean}} options
 * @returns {{args: string[], address: {ip: string, prefix: number}|null}}
 */
function buildIpv4Args (conSettings, { isNew = false } = {}) {
  const ip = conSettings.ipaddress
  if (conSettings.mode === 'ap') {
    if (!ip) {
      return { args: isNew ? ['ipv4.method', 'shared'] : [], address: null }
    }
    const address = requireSubnet(ip, 24)
    return { args: ['ipv4.addresses', `${address.ip}/24`, 'ipv4.method', 'shared'], address }
  }
  if (conSettings.ipaddresstype === 'auto') {
    return { args: isNew ? ['ipv4.method', 'auto'] : ['ipv4.method', 'auto', 'ipv4.addresses', ''], address: null }
  }
  if ((conSettings.ipaddresstype === 'manual' || conSettings.ipaddresstype === 'shared') && ip && conSettings.subnet) {
    const address = requireSubnet(ip, conSettings.subnet)
    return { args: ['ipv4.addresses', `${address.ip}/${address.prefix}`, 'ipv4.method', conSettings.ipaddresstype], address }
  }
  return { args: [], address: null }
}

function requireSubnet (ip, mask) {
  const subnet = toSubnet(ip, mask)
  if (!subnet || subnet.prefix === 0) {
    const err = new Error(`Invalid IP address or netmask: ${ip} / ${mask}`)
    err.status = 422
    throw err
  }
  return subnet
}

/**
 * 802-11-wireless properties for `nmcli connection add|modify`.
 * AP security matches deploy/wifi_access_point.sh (WPA2-only CCMP, WPS off).
 * @param {object} conSettings {mode, ssid, band, channel, wpaType, password}
 * @param {{isNew?: boolean}} options
 * @returns {string[]}
 */
function buildWifiArgs (conSettings, { isNew = false } = {}) {
  const args = []
  if (conSettings.ssid) args.push('802-11-wireless.ssid', conSettings.ssid)
  if (conSettings.mode) args.push('802-11-wireless.mode', conSettings.mode)
  const isAp = conSettings.mode === 'ap'
  if (isAp) {
    if (conSettings.band) args.push('802-11-wireless.band', conSettings.band)
    const channel = conSettings.channel !== undefined && conSettings.channel !== null ? String(conSettings.channel) : ''
    if (channel && channel !== '0') {
      args.push('802-11-wireless.channel', channel)
    } else if (!isNew && conSettings.channel !== undefined) {
      args.push('802-11-wireless.channel', '')
    }
  }
  if (conSettings.wpaType && conSettings.wpaType !== 'none') {
    args.push('802-11-wireless-security.key-mgmt', conSettings.wpaType)
    if (conSettings.password) {
      args.push('802-11-wireless-security.psk', conSettings.password)
    }
    if (isAp) {
      args.push('802-11-wireless-security.proto', 'rsn',
        '802-11-wireless-security.pairwise', 'ccmp',
        '802-11-wireless-security.group', 'ccmp',
        '802-11-wireless-security.wps-method', '1')
    }
  }
  return args
}

// Profiles created by the deploy scripts; the UI and fallback logic depend on these names
const PROFILE = {
  ETH_CLIENT: 'Ethernet-Client',
  ETH_SERVER: 'Ethernet-Server',
  WIFI_AP: 'WiFiAP'
}

const ROLES = {
  [PROFILE.ETH_CLIENT]: 'ethernet-client',
  [PROFILE.ETH_SERVER]: 'ethernet-server',
  [PROFILE.WIFI_AP]: 'wifi-ap'
}

function profileRole (name) {
  return ROLES[name] || null
}

// Rough RSSI to quality mapping used by NetworkManager: -100 dBm = 0 %, -50 dBm = 100 %
function dbmToPercent (dbm) {
  return Math.max(0, Math.min(100, Math.round(2 * (dbm + 100))))
}

function isPrintableAscii (text) {
  return /^[\x20-\x7E]+$/.test(text)
}

function dedupeStrongest (networks, hiddenSsids) {
  const bySsid = new Map()
  for (const net of networks) {
    if (!net.ssid || !isPrintableAscii(net.ssid) || hiddenSsids.includes(net.ssid)) continue
    const known = bySsid.get(net.ssid)
    if (!known || known.signal < net.signal) bySsid.set(net.ssid, net)
  }
  return Array.from(bySsid.values()).sort((a, b) => b.signal - a.signal)
}

// Parses `iw dev <if> scan` output into [{ssid, signal (%), security}]
function parseIwScan (stdout, hiddenSsids = []) {
  const networks = []
  let current = null
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('BSS ')) {
      current = { ssid: null, signal: 0, security: 'Open' }
      networks.push(current)
    } else if (!current) {
      continue
    } else if (line.startsWith('SSID:')) {
      current.ssid = line.slice(5).trim()
    } else if (line.startsWith('signal:')) {
      current.signal = dbmToPercent(parseFloat(line.split(/\s+/)[1]))
    } else if (line.startsWith('RSN:')) {
      current.security = 'WPA2'
    } else if (line.startsWith('WPA:') && current.security === 'Open') {
      current.security = 'WPA'
    } else if (line.includes('Authentication suites:') && /\bSAE\b/.test(line)) {
      current.security = 'WPA3'
    }
  }
  return dedupeStrongest(networks, hiddenSsids)
}

// Parses `nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list`
function parseNmcliWifiList (stdout, hiddenSsids = []) {
  const networks = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const [ssid, signal, rawSec = ''] = parseTerseRow(line)
    if (!ssid || ssid === '--') continue
    let security = 'Open'
    if (rawSec.includes('WPA3')) security = 'WPA3'
    else if (rawSec.includes('WPA2') || rawSec.includes('RSN')) security = 'WPA2'
    else if (rawSec.includes('WPA')) security = 'WPA'
    else if (rawSec.includes('WEP')) security = 'WEP'
    networks.push({ ssid, signal: parseInt(signal, 10) || 0, security })
  }
  return dedupeStrongest(networks, hiddenSsids)
}

// Parses `ip -o -4 addr show` into [{iface, ip, prefix}]
function parseIpAddrShow (stdout) {
  const addrs = []
  for (const line of stdout.split('\n')) {
    const match = line.match(/^\d+:\s+(\S+)\s+inet\s+([\d.]+)\/(\d+)/)
    if (match) addrs.push({ iface: match[1], ip: match[2], prefix: parseInt(match[3], 10) })
  }
  return addrs
}

module.exports = {
  PROFILE,
  parseIpAddrShow,
  profileRole,
  parseIwChannels,
  parseIwScan,
  parseNmcliWifiList,
  buildIpv4Args,
  buildWifiArgs
}
