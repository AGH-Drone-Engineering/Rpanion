const assert = require('assert')
const { parseIPv4, netmaskToPrefix, toSubnet, subnetContains, prefixToNetmask, subnetsOverlap } = require('./ipv4Subnet')

describe('ipv4Subnet', function () {
  it('parses dotted IPv4 to unsigned int', function () {
    assert.strictEqual(parseIPv4('192.168.144.14'), 0xC0A8900E)
    assert.strictEqual(parseIPv4('255.255.255.255'), 0xFFFFFFFF)
    assert.strictEqual(parseIPv4('256.1.1.1'), null)
    assert.strictEqual(parseIPv4('1.2.3'), null)
    assert.strictEqual(parseIPv4(''), null)
    assert.strictEqual(parseIPv4(undefined), null)
  })

  it('converts netmask or prefix to prefix length', function () {
    assert.strictEqual(netmaskToPrefix('255.255.255.0'), 24)
    assert.strictEqual(netmaskToPrefix('255.255.0.0'), 16)
    assert.strictEqual(netmaskToPrefix('255.255.255.255'), 32)
    assert.strictEqual(netmaskToPrefix('24'), 24)
    assert.strictEqual(netmaskToPrefix(16), 16)
    assert.strictEqual(netmaskToPrefix('255.0.255.0'), null)
    assert.strictEqual(netmaskToPrefix('33'), null)
  })

  it('builds subnet from ip and netmask, or from CIDR string', function () {
    assert.deepStrictEqual(toSubnet('10.0.3.1', '255.255.255.0'), { ip: '10.0.3.1', prefix: 24 })
    assert.deepStrictEqual(toSubnet('10.0.3.1/16'), { ip: '10.0.3.1', prefix: 16 })
    assert.strictEqual(toSubnet('10.0.3.1', 'bad'), null)
    assert.strictEqual(toSubnet('nope', '255.255.255.0'), null)
  })

  it('checks address membership', function () {
    const net = toSubnet('192.168.144.20', '255.255.255.0')
    assert.strictEqual(subnetContains(net, '192.168.144.14'), true)
    assert.strictEqual(subnetContains(net, '192.168.145.14'), false)
    assert.strictEqual(subnetContains(toSubnet('192.168.144.20/32'), '192.168.144.14'), false)
    assert.strictEqual(subnetContains(toSubnet('0.0.0.0/0'), '8.8.8.8'), true)
  })

  describe('prefixToNetmask', function () {
    it('converts prefix length to dotted netmask', function () {
      assert.strictEqual(prefixToNetmask(24), '255.255.255.0')
      assert.strictEqual(prefixToNetmask('16'), '255.255.0.0')
      assert.strictEqual(prefixToNetmask(32), '255.255.255.255')
      assert.strictEqual(prefixToNetmask(0), '0.0.0.0')
      assert.strictEqual(prefixToNetmask(33), null)
    })
  })

  describe('subnetsOverlap', function () {
    it('detects containment in either direction', function () {
      assert.strictEqual(subnetsOverlap({ ip: '10.28.237.50', prefix: 24 }, { ip: '10.28.237.122', prefix: 24 }), true)
      assert.strictEqual(subnetsOverlap({ ip: '10.28.0.1', prefix: 16 }, { ip: '10.28.237.122', prefix: 24 }), true)
      assert.strictEqual(subnetsOverlap({ ip: '10.28.238.1', prefix: 24 }, { ip: '10.28.237.122', prefix: 24 }), false)
    })
  })
})
