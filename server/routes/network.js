/*
 * HTTP routes for network configuration. Handlers only validate input and
 * map networkManager results/errors to responses. Errors carrying a
 * `status` (conflicts, invalid input) keep it; others are 500. Failed
 * reads still include an empty payload so older clients can render.
 */
const express = require('express')
const { check, validationResult } = require('express-validator')
const { sendApiError, sendValidationError } = require('../apiResponses')

const conSettingsChecks = [
  check('conSettings.ipaddresstype').isIn(['auto', 'manual', 'shared']),
  check('conSettings.ipaddress').optional({ checkFalsy: true }).isIP(4),
  check('conSettings.subnet').optional({ checkFalsy: true }).isIP(4),
  check('conSettings.wpaType').optional().isIn(['none', 'wpa-psk']),
  check('conSettings.password').optional().isString(),
  check('conSettings.priority').optional().isInt(),
  check('conSettings.ssid').optional().isString(),
  check('conSettings.attachedIface').optional().isString(),
  check('conSettings.band').optional().isIn(['a', 'bg']),
  check('conSettings.channel').optional().isInt(),
  check('conSettings.mode').optional().isIn(['infrastructure', 'ap'])
]

function createNetworkRouter ({ networkManager, authenticateToken }) {
  const router = express.Router()

  // checks: express-validator chains; action(req) -> response body;
  // failPayload: body fields to include when action throws
  const route = (method, path, checks, action, failPayload = {}) => {
    router[method](path, authenticateToken, checks, async (req, res) => {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return sendValidationError(res, errors)
      }
      try {
        return res.json(await action(req))
      } catch (err) {
        console.error(`Error in ${path}: ${err.message || err}`)
        return sendApiError(res, err.status || 500, err, failPayload)
      }
    })
  }

  route('get', '/api/networkadapters', [],
    async () => ({ netDevice: await networkManager.getAdapters() }), { netDevice: [] })

  route('get', '/api/wifiscan', [],
    async () => ({ detWifi: await networkManager.getWifiScan() }), { detWifi: [] })

  route('get', '/api/wirelessstatus', [],
    async () => ({ wirelessEnabled: await networkManager.getWirelessStatus() }))

  route('post', '/api/setwirelessstatus', [check('status').isBoolean()],
    async (req) => ({ wirelessEnabled: await networkManager.setWirelessStatus(req.body.status) }))

  route('get', '/api/networkconnections', [],
    async () => ({ netConnection: await networkManager.getConnections() }), { netConnection: [] })

  route('post', '/api/networkIP', [check('conName').isUUID()],
    async (req) => ({ netConnectionDetails: await networkManager.getConnectionDetails(req.body.conName) }), { netConnectionDetails: {} })

  route('post', '/api/networkactivate', [check('conName').isUUID()], async (req) => {
    await networkManager.activateConnection(req.body.conName)
    return { error: null, action: 'NetworkActivateOK' }
  })

  route('post', '/api/networkdeactivate', [check('conName').isUUID()], async (req) => {
    await networkManager.deactivateConnection(req.body.conName)
    return { error: null, action: 'NetworkDectivateOK' }
  })

  route('post', '/api/networkdelete', [check('conName').isUUID()], async (req) => {
    await networkManager.deleteConnection(req.body.conName)
    return { error: null, action: 'NetworkDeleteOK' }
  })

  route('post', '/api/networkedit', [check('conName').isUUID(), ...conSettingsChecks], async (req) => {
    await networkManager.editConnection(req.body.conName, req.body.conSettings)
    return { error: null, action: 'NetworkEditOK' }
  })

  route('post', '/api/networkadd', [
    check('conName').isString().notEmpty(),
    check('conType').isIn(['wifi', 'ethernet']),
    check('conAdapter').isString().notEmpty(),
    ...conSettingsChecks
  ], async (req) => {
    const uuid = await networkManager.addConnection(req.body.conName, req.body.conType, req.body.conAdapter, req.body.conSettings)
    return { error: null, action: 'NetworkAddOK', uuid }
  })

  route('get', '/api/ethernetaliases', [], () => networkManager.getEthernetAliases())

  route('post', '/api/ethernetaliases', [
    check('aliases').isArray(),
    check('aliases.*.ip').isIP(4),
    check('aliases.*.subnet').optional({ checkFalsy: true }).isString()
  ], async (req) => {
    await networkManager.setEthernetAliases(req.body.aliases)
    return { error: null }
  })

  route('get', '/api/wifisettings', [], () => networkManager.getWifiSettings())

  route('post', '/api/wifisettings', [check('apAutoReconnect').isBoolean()],
    (req) => networkManager.setWifiSettings(req.body))

  return router
}

module.exports = createNetworkRouter
