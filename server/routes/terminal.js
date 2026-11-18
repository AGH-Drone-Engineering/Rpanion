/*
 * HTTP routes for the web terminal session: status with memory and CPU counters of the session
 * slice, asynchronous stop and the session logs. The terminal itself runs over socket.io
 * (server/terminal.js).
 */
const express = require('express')
const { param, body, validationResult } = require('express-validator')
const { sendApiError, sendValidationError } = require('../apiResponses')

function createTerminalRouter ({ terminalSystem, authenticateToken, terminalLogs }) {
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

  route('get', '/api/terminal/status', [], async () => {
    const [state, stats] = await Promise.all([terminalSystem.getActiveState(), terminalSystem.getStats()])
    return { ...state, ...stats }
  })

  route('post', '/api/terminal/stop', [], async () => {
    await terminalSystem.stop()
    return { stopping: true }
  })

  route('get', '/api/terminal/logs', [], async () => ({
    enabled: terminalLogs.isEnabled(),
    files: await terminalLogs.list()
  }))

  route('post', '/api/terminal/logs/clear', [], async () => terminalLogs.clear())

  route('post', '/api/terminal/logs/enabled', [body('enabled').isBoolean().withMessage('enabled must be a boolean')], async (req) => {
    terminalLogs.setEnabled(req.body.enabled === true || req.body.enabled === 'true')
    return { enabled: terminalLogs.isEnabled() }
  })

  const nameCheck = param('name').custom((name) => terminalLogs.isValidName(name)).withMessage('Invalid log name')
  router.get('/api/terminal/logs/:name', authenticateToken, nameCheck, (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return sendValidationError(res, errors)
    }
    try {
      const text = terminalLogs.read(req.params.name)
      res.set('Content-Disposition', `attachment; filename="${req.params.name}"`)
      return res.type('text/plain; charset=utf-8').send(text)
    } catch (err) {
      console.error(`Error reading terminal log: ${err.message || err}`)
      return sendApiError(res, err.status || 500, err)
    }
  })

  return router
}

module.exports = createTerminalRouter
