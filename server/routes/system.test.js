const assert = require('assert')
const http = require('http')
const express = require('express')
const createSystemRouter = require('./system')

function startApp (systemIdentity, authenticateToken = (req, res, next) => next()) {
  const app = express()
  app.use(express.json())
  app.use(createSystemRouter({ systemIdentity, authenticateToken }))
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

describe('system router', function () {
  let server

  afterEach(function (done) {
    if (server) server.close(done)
    else done()
  })

  function stubIdentity (overrides = {}) {
    const calls = []
    return {
      calls,
      getIdentity: () => ({ hostname: 'rpanion', sshUser: 'pi' }),
      setHostname: async (name, opts) => { calls.push(['setHostname', name, opts]) },
      setSshPassword: async (pw) => { calls.push(['setSshPassword', pw]) },
      ...overrides
    }
  }

  it('GET /api/system/identity returns hostname and ssh user', async function () {
    server = await startApp(stubIdentity())
    const res = await request(server, 'GET', '/api/system/identity')
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(res.body, { hostname: 'rpanion', sshUser: 'pi' })
  })

  it('POST /api/system/hostname lowercases and trims the name', async function () {
    const identity = stubIdentity()
    server = await startApp(identity)
    const res = await request(server, 'POST', '/api/system/hostname', { hostname: ' Rpanion-07 ' })
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(identity.calls, [['setHostname', 'rpanion-07', { updateApSsid: false }]])
    assert.strictEqual(res.body.infoMessage, 'Device name updated')
  })

  it('POST /api/system/hostname passes updateApSsid and rejects non-boolean values', async function () {
    const identity = stubIdentity()
    server = await startApp(identity)
    const ok = await request(server, 'POST', '/api/system/hostname', { hostname: 'drone-1', updateApSsid: true })
    assert.strictEqual(ok.status, 200)
    assert.strictEqual(ok.body.updateApSsid, true)
    const bad = await request(server, 'POST', '/api/system/hostname', { hostname: 'drone-1', updateApSsid: 'yes' })
    assert.strictEqual(bad.status, 422)
    assert.deepStrictEqual(identity.calls, [['setHostname', 'drone-1', { updateApSsid: true }]])
  })

  it('POST /api/system/hostname returns 422 for an invalid name', async function () {
    const identity = stubIdentity()
    server = await startApp(identity)
    for (const hostname of ['', 'bad_name', '-x', 'a b', 'x'.repeat(33), 'localhost', '1234']) {
      const res = await request(server, 'POST', '/api/system/hostname', { hostname })
      assert.strictEqual(res.status, 422, hostname)
    }
    assert.strictEqual(identity.calls.length, 0)
  })

  it('POST /api/system/hostname keeps the status of errors from the backend', async function () {
    const identity = stubIdentity({ setHostname: async () => { throw Object.assign(new Error('bad'), { status: 422 }) } })
    server = await startApp(identity)
    const res = await request(server, 'POST', '/api/system/hostname', { hostname: 'ok-name' })
    assert.strictEqual(res.status, 422)
    assert.strictEqual(res.body.error, 'bad')
  })

  it('POST /api/system/hostname returns 500 when the helper fails', async function () {
    const identity = stubIdentity({ setHostname: async () => { throw new Error('sudo: a password is required') } })
    server = await startApp(identity)
    const res = await request(server, 'POST', '/api/system/hostname', { hostname: 'ok-name' })
    assert.strictEqual(res.status, 500)
    assert.match(res.body.error, /password is required/)
  })

  it('POST /api/system/sshpassword passes the password through', async function () {
    const identity = stubIdentity()
    server = await startApp(identity)
    const res = await request(server, 'POST', '/api/system/sshpassword', { password: 'long-enough-pw' })
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(identity.calls, [['setSshPassword', 'long-enough-pw']])
    assert.ok(!JSON.stringify(res.body).includes('long-enough-pw'))
  })

  it('POST /api/system/sshpassword returns 422 for a short password', async function () {
    const identity = stubIdentity()
    server = await startApp(identity)
    const res = await request(server, 'POST', '/api/system/sshpassword', { password: 'short' })
    assert.strictEqual(res.status, 422)
    assert.strictEqual(identity.calls.length, 0)
  })

  it('rejects requests the auth middleware denies', async function () {
    const deny = (req, res) => res.status(401).json({ error: 'denied' })
    const identity = stubIdentity()
    server = await startApp(identity, deny)
    const res = await request(server, 'POST', '/api/system/hostname', { hostname: 'ok-name' })
    assert.strictEqual(res.status, 401)
    assert.strictEqual(identity.calls.length, 0)
  })
})
