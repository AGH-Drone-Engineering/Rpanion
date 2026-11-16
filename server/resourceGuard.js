/*
 * Checks start/configuration requests against resources held by other services.
 * Reads state from the managers and applies the rules in resourceConflicts.js.
 * Every check returns a user-facing error message, or null when the request is allowed.
 */
const fs = require('fs')
const { toSubnet } = require('./ipv4Subnet')
const { findSerialPortConflict, findPppSubnetConflict, findStaticSubnetConflict } = require('./resourceConflicts')

const TELEMETRY_OWNER = 'Flight controller telemetry'
const PPP_OWNER = 'PPP'

// Different device values can point at one tty (e.g. /dev/serial0 -> /dev/ttyAMA0)
function canonicalPath (devPath) {
  if (!devPath) return devPath
  try {
    return fs.realpathSync(devPath)
  } catch (_) {
    return devPath
  }
}

function canonicalClaim (owner, claim) {
  if (!claim) return null
  return { owner, device: claim.device, path: canonicalPath(claim.path) }
}

class ResourceGuard {
  /**
   * Managers are passed as getters because they are constructed after the guard
   * and PPP calls the guard from its own constructor-triggered autostart.
   */
  constructor ({ getFcManager, getPppManager, networkManager }) {
    this.getFcManager = getFcManager
    this.getPppManager = getPppManager
    this.networkManager = networkManager
  }

  telemetryClaim () {
    const fc = this.getFcManager()
    return canonicalClaim(TELEMETRY_OWNER, fc && fc.getSerialPortClaim())
  }

  pppClaim () {
    const ppp = this.getPppManager()
    return canonicalClaim(PPP_OWNER, ppp && ppp.getSerialPortClaim())
  }

  /**
   * @param {{device: string, path: string, localIP: string, remoteIP: string}} request
   * @returns {Promise<string|null>}
   */
  async checkPppStart (request) {
    const port = { device: request.device, path: canonicalPath(request.path) }
    const portConflict = findSerialPortConflict(port, [this.telemetryClaim()])
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
    return findSerialPortConflict(port, [this.pppClaim()])
  }

  /**
   * @param {{ip: string, subnet: string}} request subnet is a netmask or prefix length
   * @returns {string|null}
   */
  checkStaticIp (request) {
    const ppp = this.getPppManager()
    const endpoints = ppp && ppp.getActiveEndpoints()
    if (!endpoints) return null
    const subnet = toSubnet(request.ip, request.subnet)
    if (!subnet) return `Invalid IP address or netmask: ${request.ip} / ${request.subnet}`
    return findStaticSubnetConflict(subnet, endpoints)
  }

  /**
   * @param {Array<{ip: string, subnet: string}>} requests
   * @returns {string|null} first conflict found
   */
  checkStaticIps (requests) {
    for (const request of requests) {
      const conflict = this.checkStaticIp(request)
      if (conflict) return conflict
    }
    return null
  }
}

module.exports = ResourceGuard
