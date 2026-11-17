const assert = require('assert')
const http = require('http')
const express = require('express')
const createTerminalRouter = require('./terminal')

function startApp (terminalSystem, authenticateToken = (req, res, next) => next()) {
  const app = express()
  app.use(express.json())
  app.use(createTerminalRouter({ terminalSystem, authenticateToken }))
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server))
  })
}

function request (server, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      method,
      path,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }))
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

function stubSystem (overrides = {}) {
  const calls = []
  return {
    calls,
    getActiveState: async () => ({ installed: true, activeState: 'active' }),
    getStats: async () => ({
      memory: { controller: true, anonBytes: 1000, maxBytes: null, totalBytes: 5000, oomKills: 2 },
      cpu: { usageUsec: 42, cores: 4 },
      sampledAt: 1
    }),
    stop: async () => { calls.push(['stop']) },
    ...overrides
  }
}

describe('terminal router', function () {
  let server

  afterEach(function (done) {
    if (server) server.close(done)
    else done()
  })

  it('GET /api/terminal/status merges unit state and session counters', async function () {
    server = await startApp(stubSystem())
    const res = await request(server, 'GET', '/api/terminal/status')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.activeState, 'active')
    assert.strictEqual(res.body.installed, true)
    assert.strictEqual(res.body.memory.oomKills, 2)
    assert.strictEqual(res.body.cpu.usageUsec, 42)
    assert.strictEqual(res.body.memory.totalBytes, 5000)
  })

  it('POST /api/terminal/stop returns without waiting for the unit', async function () {
    const system = stubSystem()
    server = await startApp(system)
    const res = await request(server, 'POST', '/api/terminal/stop')
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(res.body, { stopping: true })
    assert.deepStrictEqual(system.calls, [['stop']])
  })

  it('POST /api/terminal/stop returns 500 when sudo fails', async function () {
    server = await startApp(stubSystem({ stop: async () => { throw new Error('sudo: a password is required') } }))
    const res = await request(server, 'POST', '/api/terminal/stop')
    assert.strictEqual(res.status, 500)
    assert.match(res.body.error, /password is required/)
  })

  it('rejects requests the auth middleware denies', async function () {
    const deny = (req, res) => res.status(401).json({ error: 'denied' })
    const system = stubSystem()
    server = await startApp(system, deny)
    for (const [method, path] of [['GET', '/api/terminal/status'], ['POST', '/api/terminal/stop']]) {
      const res = await request(server, method, path)
      assert.strictEqual(res.status, 401, path)
    }
    assert.strictEqual(system.calls.length, 0)
  })
})
