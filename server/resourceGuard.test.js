const assert = require('assert')
const ResourceGuard = require('./resourceGuard')

function makeGuard ({ fcClaim = null, pppClaim = null, pppEndpoints = null, staticSubnets = [] } = {}) {
  const fc = { getSerialPortClaim: () => fcClaim }
  const ppp = { getSerialPortClaim: () => pppClaim, getActiveEndpoints: () => pppEndpoints }
  const networkManager = { getStaticIPv4Subnets: async () => staticSubnets }
  return new ResourceGuard({ getFcManager: () => fc, getPppManager: () => ppp, networkManager })
}

describe('ResourceGuard', function () {
  const port = { device: 'usb-ArduPilot-if00', path: '/dev/ttyACM0' }

  it('blocks PPP on the telemetry port', async function () {
    const guard = makeGuard({ fcClaim: port })
    const msg = await guard.checkPppStart({ ...port, localIP: '10.9.0.1', remoteIP: '10.9.0.2' })
    assert.ok(msg.includes('Flight controller telemetry'))
  })

  it('blocks PPP endpoints inside a static subnet', async function () {
    const guard = makeGuard({ staticSubnets: [{ name: 'Ethernet-Client', ip: '192.168.144.20', prefix: 24 }] })
    const msg = await guard.checkPppStart({ device: 'x', path: '/dev/ttyAMA0', localIP: '192.168.144.14', remoteIP: '192.168.144.15' })
    assert.ok(msg.includes('Ethernet-Client'))
  })

  it('allows PPP when port and subnet are free', async function () {
    const guard = makeGuard({ fcClaim: port, staticSubnets: [{ name: 'Ethernet-Server', ip: '10.0.3.1', prefix: 24 }] })
    const msg = await guard.checkPppStart({ device: 'x', path: '/dev/ttyAMA0', localIP: '192.168.144.14', remoteIP: '192.168.144.15' })
    assert.strictEqual(msg, null)
  })

  it('blocks telemetry on the PPP port', function () {
    const guard = makeGuard({ pppClaim: port })
    assert.ok(guard.checkTelemetryStart(port).includes('PPP'))
    assert.strictEqual(guard.checkTelemetryStart({ device: 'y', path: '/dev/ttyAMA0' }), null)
  })

  it('blocks a static IP whose subnet contains active PPP endpoints', function () {
    const guard = makeGuard({ pppEndpoints: { localIP: '192.168.144.14', remoteIP: '192.168.144.15' } })
    assert.ok(guard.checkStaticIp({ ip: '192.168.144.20', subnet: '255.255.255.0' }).includes('PPP'))
    assert.strictEqual(guard.checkStaticIp({ ip: '192.168.1.20', subnet: '255.255.255.0' }), null)
    assert.ok(guard.checkStaticIps([{ ip: '10.0.0.1', subnet: '24' }, { ip: '192.168.144.1', subnet: '24' }]).includes('192.168.144.1/24'))
  })

  it('allows any static IP when PPP is disabled', function () {
    const guard = makeGuard({ pppEndpoints: null })
    assert.strictEqual(guard.checkStaticIp({ ip: '192.168.144.20', subnet: '255.255.255.0' }), null)
  })

  it('rejects an invalid netmask', function () {
    const guard = makeGuard({ pppEndpoints: { localIP: '192.168.144.14', remoteIP: '192.168.144.15' } })
    assert.ok(guard.checkStaticIp({ ip: '192.168.144.20', subnet: '255.0.255.0' }).includes('netmask'))
  })
})
