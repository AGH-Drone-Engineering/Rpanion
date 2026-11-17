/*
 * HTTP routes for device name (hostname and AP SSID) and SSH password. Errors carrying a `status`
 * (invalid input) keep it; others are 500.
 */
const express = require('express')
const { check, validationResult } = require('express-validator')
const { sendApiError, sendValidationError } = require('../apiResponses')
const { isValidDeviceName, DEVICE_NAME_RULES, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } = require('../systemIdentity')

function createSystemRouter ({ systemIdentity, authenticateToken }) {
  const router = express.Router()

  const route = (method, path, checks, action) => {
    router[method](path, authenticateToken, checks, async (req, res) => {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return sendValidationError(res, errors)
      }
      try {
        return res.json(await action(req))
      } catch (err) {
        console.error(`Error in ${path}: ${err.message || err}`)
        return sendApiError(res, err.status || 500, err)
      }
    })
  }

  route('get', '/api/system/identity', [], async () => systemIdentity.getIdentity())

  route('post', '/api/system/hostname',
    [check('hostname').isString().trim().toLowerCase().custom(isValidDeviceName).withMessage(DEVICE_NAME_RULES)],
    async (req) => {
      await systemIdentity.setHostname(req.body.hostname)
      return { ...systemIdentity.getIdentity(), infoMessage: 'Device name updated' }
    })

  route('post', '/api/system/sshpassword',
    [check('password').isString().isLength({ min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH })
      .withMessage(`SSH password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`)],
    async (req) => {
      await systemIdentity.setSshPassword(req.body.password)
      return { infoMessage: 'SSH password updated' }
    })

  return router
}

module.exports = createSystemRouter
