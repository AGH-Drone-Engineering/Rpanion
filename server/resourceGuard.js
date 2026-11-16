/*
 * Conflict checks for resources shared between services: serial ports
 * (telemetry vs PPP) and IPv4 subnets (PPP vs static addresses).
 * Rules are pure functions; ResourceGuard feeds them the managers' state.
 * Every check returns a user-facing error message, or null when allowed.
 */
const fs = require('fs')
const { subnetContains, formatSubnet } = require('./ipv4Subnet')

const TELEMETRY_OWNER = 'Flight controller telemetry'
const PPP_OWNER = 'PPP'

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

// Different device values can point at one tty (e.g. /dev/serial0 -> /dev/ttyAMA0)
function canonicalPath (devPath) {
  if (!devPath) return devPath
  try {
    return fs.realpathSync(devPath)
  } catch (_) {
    return devPath
  }
}

// Serial device values are either /dev paths or USB ids; a claim made before
// device detection finished has no path, so fall back to a /dev-style value.
function canonicalClaim (owner, claim) {
  if (!claim) return null
  const devPath = claim.path || (typeof claim.device === 'string' && claim.device.startsWith('/dev/') ? claim.device : null)
  return { owner, device: claim.device, path: canonicalPath(devPath) }
}

class ResourceGuard {
  constructor ({ fcManager, pppManager, networkManager }) {
    this.fcManager = fcManager
    this.pppManager = pppManager
    this.networkManager = networkManager
  }

  /**
   * @param {{device: string, path: string, localIP: string, remoteIP: string}} request
   * @returns {Promise<string|null>} rejects when static subnets cannot be read
   */
  async checkPppStart (request) {
    const port = { device: request.device, path: canonicalPath(request.path) }
    const portConflict = findSerialPortConflict(port, [canonicalClaim(TELEMETRY_OWNER, this.fcManager.getSerialPortClaim())])
    if (portConflict) return portConflict

    const staticSubnets = await this.networkManager.getStaticIPv4Subnets()
    return findPppSubnetConflict(request, staticSubnets)
  }

  /**
   * @param {{device: string, path: string}} request
   * @returns {string|null}
   */
  checkTelemetryStart (request) {
    const port = { device: request.device, path: canonicalPath(request.path) }
    return findSerialPortConflict(port, [canonicalClaim(PPP_OWNER, this.pppManager.getSerialPortClaim())])
  }

  /**
   * @param {{ip: string, prefix: number}} subnet static address about to be applied
   * @returns {string|null}
   */
  checkStaticIp (subnet) {
    return findStaticSubnetConflict(subnet, this.pppManager.getActiveEndpoints())
  }
}

module.exports = ResourceGuard
module.exports.findSerialPortConflict = findSerialPortConflict
module.exports.findPppSubnetConflict = findPppSubnetConflict
module.exports.findStaticSubnetConflict = findStaticSubnetConflict
