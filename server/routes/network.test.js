const assert = require('assert')
const http = require('http')
const express = require('express')
const createNetworkRouter = require('./network')

function startApp (networkManager) {
  const app = express()
  app.use(express.json())
  app.use(createNetworkRouter({ networkManager, authenticateToken: (req, res, next) => next() }))
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

const UUID = '7c39cc41-3f26-4be4-9173-44794f3c5447'

describe('network router', function () {
  let server

  afterEach(function (done) {
    server.close(done)
  })

  it('returns adapters', async function () {
    server = await startApp({ getAdapters: async () => [{ value: 'eth0' }] })
    const res = await request(server, 'GET', '/api/networkadapters')
    assert.deepStrictEqual(res, { status: 200, body: { netDevice: [{ value: 'eth0' }] } })
  })

  it('reports failures with status 500, message and empty payload', async function () {
    server = await startApp({ getAdapters: async () => { throw new Error('nmcli not running') } })
    const res = await request(server, 'GET', '/api/networkadapters')
    assert.strictEqual(res.status, 500)
    assert.strictEqual(res.body.error, 'nmcli not running')
    assert.deepStrictEqual(res.body.netDevice, [])
  })

  it('uses the status attached to request errors', async function () {
    const err = new Error('Static IP overlaps PPP')
    err.status = 409
    server = await startApp({ editConnection: async () => { throw err } })
    const res = await request(server, 'POST', '/api/networkedit', { conName: UUID, conSettings: { ipaddresstype: 'manual', ipaddress: '192.168.144.2', subnet: '255.255.255.0' } })
    assert.strictEqual(res.status, 409, JSON.stringify(res.body))
    assert.strictEqual(res.body.error, 'Static IP overlaps PPP')
  })

  it('passes add parameters through and returns the UUID', async function () {
    let received
    server = await startApp({ addConnection: async (...args) => { received = args; return UUID } })
    const res = await request(server, 'POST', '/api/networkadd', { conName: 'x', conType: 'ethernet', conAdapter: 'eth0', conSettings: { ipaddresstype: 'auto' } })
    assert.deepStrictEqual(res.body, { error: null, action: 'NetworkAddOK', uuid: UUID })
    assert.deepStrictEqual(received, ['x', 'ethernet', 'eth0', { ipaddresstype: 'auto' }])
  })

  it('rejects alias entries that are not IPv4 addresses', async function () {
    server = await startApp({ setEthernetAliases: async () => 'OK' })
    const res = await request(server, 'POST', '/api/ethernetaliases', { aliases: [{ ip: '$(id)', subnet: '255.255.255.0' }] })
    assert.strictEqual(res.status, 422)
  })

  it('rejects a non-UUID connection name', async function () {
    server = await startApp({ activateConnection: async () => 'OK' })
    const res = await request(server, 'POST', '/api/networkactivate', { conName: 'Ethernet-Server' })
    assert.strictEqual(res.status, 422)
  })

  it('no longer serves the single-alias endpoint', async function () {
    server = await startApp({})
    const res = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/ethernetalias' }, r => { r.resume(); resolve(r.statusCode) })
    })
    assert.strictEqual(res, 404)
  })
})
