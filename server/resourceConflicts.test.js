const assert = require('assert')
const { findSerialPortConflict, findPppSubnetConflict, findStaticSubnetConflict } = require('./resourceConflicts')

describe('resourceConflicts', function () {
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
