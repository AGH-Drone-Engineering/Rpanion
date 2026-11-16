/*
 * IPv4 address and subnet arithmetic.
 * Subnets are represented as { ip: 'a.b.c.d', prefix: 0..32 }.
 */

function parseIPv4 (ip) {
  if (typeof ip !== 'string') return null
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

// Accepts a dotted netmask ('255.255.255.0') or a prefix length (24 / '24')
function netmaskToPrefix (mask) {
  if (typeof mask === 'number' || /^\d{1,2}$/.test(String(mask).trim())) {
    const prefix = Number(mask)
    return Number.isInteger(prefix) && prefix >= 0 && prefix <= 32 ? prefix : null
  }
  const value = parseIPv4(mask)
  if (value === null) return null
  const bits = value.toString(2).padStart(32, '0')
  if (!/^1*0*$/.test(bits)) return null
  return bits.indexOf('0') === -1 ? 32 : bits.indexOf('0')
}

// toSubnet('10.0.3.1', '255.255.255.0') or toSubnet('10.0.3.1/24')
function toSubnet (ip, mask) {
  let addr = ip
  let maskPart = mask
  if (mask === undefined && typeof ip === 'string' && ip.includes('/')) {
    [addr, maskPart] = ip.split('/')
  }
  if (parseIPv4(addr) === null) return null
  const prefix = netmaskToPrefix(maskPart)
  if (prefix === null) return null
  return { ip: addr.trim(), prefix }
}

function maskBits (prefix) {
  return prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0
}

function subnetContains (subnet, ip) {
  const net = parseIPv4(subnet && subnet.ip)
  const addr = parseIPv4(ip)
  if (net === null || addr === null) return false
  const mask = maskBits(subnet.prefix)
  return ((net & mask) >>> 0) === ((addr & mask) >>> 0)
}

function prefixToNetmask (prefix) {
  const value = Number(prefix)
  if (!Number.isInteger(value) || value < 0 || value > 32) return null
  const mask = maskBits(value)
  return [24, 16, 8, 0].map(shift => (mask >>> shift) & 255).join('.')
}

function formatSubnet (subnet) {
  return `${subnet.ip}/${subnet.prefix}`
}

module.exports = { parseIPv4, netmaskToPrefix, prefixToNetmask, toSubnet, subnetContains, formatSubnet }
