const assert = require('assert')
const http = require('http')
const express = require('express')
const createTerminalRouter = require('./terminal')

function startApp (terminalSystem, authenticateToken = (req, res, next) => next(), terminalLogs = stubLogs()) {
  const app = express()
  app.use(express.json())
  app.use(createTerminalRouter({ terminalSystem, authenticateToken, terminalLogs }))
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
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(raw || '{}') } catch (e) { parsed = raw }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers })
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

function stubLogs (overrides = {}) {
  const calls = []
  return {
    calls,
    isValidName: (name) => /^[\w-]+\.log$/.test(name),
    isEnabled: () => true,
    setEnabled: (enabled) => { calls.push(['setEnabled', enabled]) },
    list: async () => [{ name: 'a.log', size: 1, modified: 'x', active: false }],
    clear: async () => ({ deleted: 2, skipped: 1 }),
    read: (name) => `text of ${name}`,
    ...overrides
  }
}

function stubSystem (overrides = {}) {
  const calls = []
  return {
    calls,
    getActiveState: async () => ({ installed: true, activeState: 'active' }),
    getStats: async () => ({
      memory: { controller: true, anonBytes: 1000, totalBytes: 5000, oomKills: 2 },
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
    for (const [method, path] of [['GET', '/api/terminal/status'], ['POST', '/api/terminal/stop'], ['GET', '/api/terminal/logs'], ['POST', '/api/terminal/logs/clear'], ['POST', '/api/terminal/logs/enabled'], ['GET', '/api/terminal/logs/a.log']]) {
      const res = await request(server, method, path)
      assert.strictEqual(res.status, 401, path)
    }
    assert.strictEqual(system.calls.length, 0)
  })

  describe('session logs', function () {
    it('GET /api/terminal/logs returns the setting and files', async function () {
      server = await startApp(stubSystem())
      const res = await request(server, 'GET', '/api/terminal/logs')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.body.enabled, true)
      assert.strictEqual(res.body.files[0].name, 'a.log')
    })

    it('POST /api/terminal/logs/clear returns the counts', async function () {
      server = await startApp(stubSystem())
      const res = await request(server, 'POST', '/api/terminal/logs/clear')
      assert.deepStrictEqual(res.body, { deleted: 2, skipped: 1 })
    })

    it('POST /api/terminal/logs/enabled switches logging and validates the body', async function () {
      const logs = stubLogs()
      server = await startApp(stubSystem(), undefined, logs)
      const res = await request(server, 'POST', '/api/terminal/logs/enabled', { enabled: false })
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(logs.calls, [['setEnabled', false]])
      const bad = await request(server, 'POST', '/api/terminal/logs/enabled', { enabled: 'maybe' })
      assert.strictEqual(bad.status, 422)
      assert.strictEqual(logs.calls.length, 1)
    })

    it('GET /api/terminal/logs/:name sends the text as an attachment', async function () {
      server = await startApp(stubSystem())
      const res = await request(server, 'GET', '/api/terminal/logs/a.log')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.body, 'text of a.log')
      assert.match(res.headers['content-type'], /^text\/plain/)
      assert.match(res.headers['content-disposition'], /attachment; filename="a.log"/)
    })

    it('GET /api/terminal/logs/:name rejects names with a path', async function () {
      const logs = stubLogs({ read: () => { throw new Error('must not be called') } })
      server = await startApp(stubSystem(), undefined, logs)
      for (const name of ['..%2F..%2Fconfig%2Fuser.json', '%2e%2e', 'a.txt', 'a%2Fb.log']) {
        const res = await request(server, 'GET', `/api/terminal/logs/${name}`)
        assert.ok(res.status === 422 || res.status === 404, `${name}: ${res.status}`)
      }
    })

    it('GET /api/terminal/logs/:name returns the status of a read error', async function () {
      const logs = stubLogs({ read: () => { const e = new Error('Log not found'); e.status = 404; throw e } })
      server = await startApp(stubSystem(), undefined, logs)
      const res = await request(server, 'GET', '/api/terminal/logs/a.log')
      assert.strictEqual(res.status, 404)
      assert.match(res.body.error, /not found/)
    })
  })
})
