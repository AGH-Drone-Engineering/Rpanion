const { toSubnet } = require('./ipv4Subnet')

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
    throw new Error(`Invalid IP address or netmask: ${ip} / ${mask}`)
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

module.exports = { parseIwChannels, buildIpv4Args, buildWifiArgs }
