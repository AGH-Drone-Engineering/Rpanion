/*
 * HTTP routes for the web terminal session: status with memory and CPU counters of the session
 * slice and asynchronous stop. The terminal itself runs over socket.io
 * (server/terminal.js).
 */
const express = require('express')
const { validationResult } = require('express-validator')
const { sendApiError, sendValidationError } = require('../apiResponses')

function createTerminalRouter ({ terminalSystem, authenticateToken }) {
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

  return router
}

module.exports = createTerminalRouter
