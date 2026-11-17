const assert = require('assert')
const ResourceGuard = require('./resourceGuard')
const { findSerialPortConflict, findPppSubnetConflict, findStaticSubnetConflict } = ResourceGuard

function makeGuard ({ fcClaim = null, pppClaim = null, pppEndpoints = null, staticSubnets = [] } = {}) {
  const fcManager = { getSerialPortClaim: () => fcClaim }
  const pppManager = { getSerialPortClaim: () => pppClaim, getActiveEndpoints: () => pppEndpoints }
  const networkManager = { getStaticIPv4Subnets: async () => staticSubnets }
  return new ResourceGuard({ fcManager, pppManager, networkManager })
}

describe('ResourceGuard', function () {
  const port = { device: 'usb-ArduPilot-if00', path: '/dev/ttyACM0' }

  it('blocks PPP on the telemetry port', async function () {
    const guard = makeGuard({ fcClaim: port })
    const msg = await guard.checkPppStart({ ...port, localIP: '10.9.0.1', remoteIP: '10.9.0.2' })
    assert.ok(msg.includes('Flight controller telemetry'))
  })

  it('compares a claim without a resolved path by its /dev device value', async function () {
    const guard = makeGuard({ fcClaim: { device: '/dev/ttyACM0', path: null } })
    const msg = await guard.checkPppStart({ device: 'usb-x', path: '/dev/ttyACM0', localIP: '10.9.0.1', remoteIP: '10.9.0.2' })
    assert.notStrictEqual(msg, null)
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

  it('propagates a failed subnet lookup as a rejection', async function () {
    const guard = makeGuard()
    guard.networkManager.getStaticIPv4Subnets = async () => { throw new Error('nmcli failed') }
    await assert.rejects(guard.checkPppStart({ device: 'x', path: '/dev/ttyAMA0', localIP: '1.1.1.1', remoteIP: '1.1.1.2' }))
  })

  it('blocks telemetry on the PPP port', function () {
    const guard = makeGuard({ pppClaim: port })
    assert.ok(guard.checkTelemetryStart(port).includes('PPP'))
    assert.strictEqual(guard.checkTelemetryStart({ device: 'y', path: '/dev/ttyAMA0' }), null)
  })

  it('blocks a static subnet that contains enabled PPP endpoints', function () {
    const guard = makeGuard({ pppEndpoints: { localIP: '192.168.144.14', remoteIP: '192.168.144.15' } })
    assert.ok(guard.checkStaticIp({ ip: '192.168.144.20', prefix: 24 }).includes('PPP'))
    assert.strictEqual(guard.checkStaticIp({ ip: '192.168.1.20', prefix: 24 }), null)
  })

  it('allows any static IP when PPP is disabled', function () {
    const guard = makeGuard({ pppEndpoints: null })
    assert.strictEqual(guard.checkStaticIp({ ip: '192.168.144.20', prefix: 24 }), null)
  })

  describe('resourceGuard rules', function () {
    describe('findSerialPortConflict', function () {
      const telemetryClaim = { owner: 'Flight controller telemetry', device: 'usb-ArduPilot-if00', path: '/dev/ttyACM0' }

      it('reports conflict when the same device value is claimed', function () {
        const msg = findSerialPortConflict({ device: 'usb-ArduPilot-if00', path: '/dev/ttyACM0' }, [telemetryClaim])
        assert.ok(msg.includes('Flight controller telemetry'))
        assert.ok(msg.includes('/dev/ttyACM0'))
      })

      it('reports conflict when different values resolve to the same path', function () {
        const msg = findSerialPortConflict({ device: '/dev/serial0', path: '/dev/ttyACM0' }, [telemetryClaim])
        assert.notStrictEqual(msg, null)
      })

      it('allows a different port', function () {
        assert.strictEqual(findSerialPortConflict({ device: '/dev/ttyAMA0', path: '/dev/ttyAMA0' }, [telemetryClaim]), null)
      })

      it('ignores empty claims', function () {
        assert.strictEqual(findSerialPortConflict({ device: 'x', path: '/dev/x' }, [null, { owner: 'PPP', device: null, path: null }]), null)
      })
    })

    describe('findPppSubnetConflict', function () {
      const ppp = { localIP: '192.168.144.14', remoteIP: '192.168.144.15' }

      it('reports conflict when a static subnet contains a PPP endpoint', function () {
        const msg = findPppSubnetConflict(ppp, [{ name: 'Ethernet-Client', ip: '192.168.144.20', prefix: 24 }])
        assert.ok(msg.includes('Ethernet-Client'))
        assert.ok(msg.includes('192.168.144.20/24'))
      })

      it('allows non-overlapping static subnets', function () {
        assert.strictEqual(findPppSubnetConflict(ppp, [{ name: 'Ethernet-Server', ip: '10.0.3.1', prefix: 24 }]), null)
      })

      it('allows a host route that does not contain the endpoints', function () {
        assert.strictEqual(findPppSubnetConflict(ppp, [{ name: 'alias', ip: '192.168.144.50', prefix: 32 }]), null)
      })

      it('returns null when PPP addresses are missing', function () {
        assert.strictEqual(findPppSubnetConflict(null, [{ name: 'a', ip: '192.168.144.1', prefix: 24 }]), null)
      })
    })

    describe('findStaticSubnetConflict', function () {
      const ppp = { localIP: '192.168.144.14', remoteIP: '192.168.144.15' }

      it('reports conflict when the static subnet contains a PPP endpoint', function () {
        const msg = findStaticSubnetConflict({ ip: '192.168.144.20', prefix: 24 }, ppp)
        assert.ok(msg.includes('192.168.144.20/24'))
        assert.ok(msg.includes('192.168.144.14'))
      })

      it('allows other subnets and disabled PPP', function () {
        assert.strictEqual(findStaticSubnetConflict({ ip: '10.0.3.1', prefix: 24 }, ppp), null)
        assert.strictEqual(findStaticSubnetConflict({ ip: '192.168.144.20', prefix: 24 }, null), null)
      })
    })
  })
})
