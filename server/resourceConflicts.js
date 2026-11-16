/*
 * Conflict rules for resources shared between services.
 * Each rule returns a user-facing error message, or null when there is no conflict.
 */
const { subnetContains, formatSubnet } = require('./ipv4Subnet')

/**
 * A serial port can be opened by one service only. Two services on one
 * port (e.g. mavlink-router and pppd on /dev/ttyACM0) corrupt each other's
 * byte stream and the FC link never receives a heartbeat.
 * @param {{device: string, path: string}} requested
 * @param {Array<{owner: string, device: string, path: string}>} claims ports held by other services
 */
function findSerialPortConflict (requested, claims) {
  for (const claim of claims) {
    if (!claim || (!claim.device && !claim.path)) continue
    const sameDevice = claim.device && claim.device === requested.device
    const samePath = claim.path && claim.path === requested.path
    if (sameDevice || samePath) {
      const port = requested.path || requested.device
      return `Serial port ${port} is already used by ${claim.owner}. ` +
        `Stop ${claim.owner} or select a different port.`
    }
  }
  return null
}

/**
 * PPP endpoints must not fall inside a statically assigned subnet, otherwise
 * the kernel has two routes to the same addresses.
 * @param {{localIP: string, remoteIP: string}} ppp
 * @param {Array<{name: string, ip: string, prefix: number}>} staticSubnets
 */
function findPppSubnetConflict (ppp, staticSubnets) {
  if (!ppp || !ppp.localIP || !ppp.remoteIP) return null
  for (const subnet of staticSubnets) {
    const endpoint = [ppp.localIP, ppp.remoteIP].find(ip => subnetContains(subnet, ip))
    if (endpoint) {
      return `PPP address ${endpoint} is inside static subnet ${formatSubnet(subnet)} (${subnet.name}). ` +
        'Change the PPP addresses or the static IP configuration.'
    }
  }
  return null
}

/**
 * Reverse direction of findPppSubnetConflict, worded for static IP configuration.
 * @param {{ip: string, prefix: number}} subnet requested static subnet
 * @param {{localIP: string, remoteIP: string}|null} ppp endpoints of enabled PPP, or null
 */
function findStaticSubnetConflict (subnet, ppp) {
  if (!ppp || !ppp.localIP || !ppp.remoteIP) return null
  const endpoint = [ppp.localIP, ppp.remoteIP].find(ip => subnetContains(subnet, ip))
  if (!endpoint) return null
  return `Static IP ${formatSubnet(subnet)} overlaps PPP address ${endpoint}. ` +
    'Disable PPP or use a different subnet.'
}

module.exports = { findSerialPortConflict, findPppSubnetConflict, findStaticSubnetConflict }
