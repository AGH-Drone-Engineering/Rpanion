const assert = require('assert')
const fs = require('fs')
const settings = require('settings-store')
try {
  settings.init({
    appName: 'rpanion-server',
    publisherName: 'Rpanion',
    reverseDNS: 'com.rpanion.rpanion-server'
  })
} catch (_) {}
const networkManager = require('./networkManager')

describe('Network Functions', function () {
  it('#networkmanagergetAdapters()', function (done) {
    // Getting a list of adapters
    networkManager.getAdapters(function (err) {
      assert.equal(err, null)
      done()
    })
  })

  it('#networkmanagergetConnections()', function (done) {
    // Getting a list of adapters
    networkManager.getConnections(function (err) {
      assert.equal(err, null)
      done()
    })
  })

  it('#getWifiScan()', function (done) {
    this.timeout(10000)
    networkManager.getWifiScan(function (err, networks) {
      assert.equal(err, null)
      assert.equal(Array.isArray(networks), true)
      done()
    })
  })

  it('#resetWifiWatchdogState()', function (done) {
    const testFile = '/run/rpanion-wifi/connected-client'
    fs.mkdirSync('/run/rpanion-wifi', { recursive: true })
    fs.writeFileSync(testFile, 'test')
    assert.equal(fs.existsSync(testFile), true)
    networkManager.resetWifiWatchdogState()
    assert.equal(fs.existsSync(testFile), false)
    done()
  })

  it('#getWifiSettings() and #setWifiSettings()', function (done) {
    networkManager.getWifiSettings(function (err, initial) {
      assert.equal(err, null)
      assert.equal(typeof initial.apAutoReconnect, 'boolean')

      networkManager.setWifiSettings({ apAutoReconnect: false }, function (err2, result) {
        assert.equal(err2, null)
        assert.equal(result.apAutoReconnect, false)

        networkManager.getWifiSettings(function (err3, current) {
          assert.equal(err3, null)
          assert.equal(current.apAutoReconnect, false)

          // Restore original
          networkManager.setWifiSettings({ apAutoReconnect: initial.apAutoReconnect }, function (err4) {
            assert.equal(err4, null)
            done()
          })
        })
      })
    })
  })
})

describe('parseStaticSubnets', function () {
  it('returns addresses of manual and shared profiles only', function () {
    const out = [
      'connection.id:Ethernet-Server', 'ipv4.method:shared', 'ipv4.addresses:10.0.3.1/24', '',
      'connection.id:bajer', 'ipv4.method:auto', 'ipv4.addresses:', '',
      'connection.id:lo', 'ipv4.method:manual', 'ipv4.addresses:127.0.0.1/8', '',
      'connection.id:Cam', 'ipv4.method:manual', 'ipv4.addresses:192.168.144.20/24,172.16.0.2/16'
    ].join('\n')
    assert.deepStrictEqual(networkManager.parseStaticSubnets(out), [
      { name: 'Ethernet-Server', ip: '10.0.3.1', prefix: 24 },
      { name: 'Cam', ip: '192.168.144.20', prefix: 24 },
      { name: 'Cam', ip: '172.16.0.2', prefix: 16 }
    ])
  })
})

describe('requestedStaticAddress', function () {
  it('maps connection settings to the address nmcli would assign', function () {
    assert.deepStrictEqual(networkManager.requestedStaticAddress({ ipaddresstype: 'manual', ipaddress: '192.168.144.20', subnet: '255.255.255.0' }),
      { ip: '192.168.144.20', subnet: '255.255.255.0' })
    assert.deepStrictEqual(networkManager.requestedStaticAddress({ mode: 'ap', ipaddresstype: 'shared', ipaddress: '10.0.2.100' }),
      { ip: '10.0.2.100', subnet: '255.255.255.0' })
    assert.strictEqual(networkManager.requestedStaticAddress({ ipaddresstype: 'auto', ipaddress: '192.168.144.20', subnet: '255.255.255.0' }), null)
    assert.strictEqual(networkManager.requestedStaticAddress({ ipaddresstype: 'manual' }), null)
  })
})

describe('validateAliasList', function () {
  it('normalises valid aliases to CIDR entries', function () {
    const { aliases, entries } = networkManager.validateAliasList([{ id: 'a1', ip: ' 10.1.1.2 ', subnet: '255.255.255.0' }, { ip: '172.16.0.9', subnet: '32' }])
    assert.deepStrictEqual(entries, ['10.1.1.2/24', '172.16.0.9/32'])
    assert.strictEqual(aliases[0].id, 'a1')
    assert.strictEqual(aliases[0].ip, '10.1.1.2')
    assert.strictEqual(aliases[1].subnet, '32')
  })

  it('defaults the netmask to /24', function () {
    assert.deepStrictEqual(networkManager.validateAliasList([{ ip: '10.1.1.2' }]).entries, ['10.1.1.2/24'])
  })

  it('rejects shell metacharacters and malformed addresses', function () {
    for (const ip of ['$(id)', '1.2.3.4"; touch /tmp/x; "', '999.1.1.1', '10.0.0.1/24', '']) {
      assert.throws(() => networkManager.validateAliasList([{ ip, subnet: '255.255.255.0' }]), /Invalid alias/, ip)
    }
  })

  it('rejects a non-contiguous netmask', function () {
    assert.throws(() => networkManager.validateAliasList([{ ip: '10.1.1.2', subnet: '255.0.255.0' }]), /Invalid alias/)
  })

  it('rejects an alias equal to an address of a NetworkManager profile', function () {
    assert.throws(() => networkManager.validateAliasList([{ ip: '10.0.3.1', subnet: '255.255.255.0' }], ['10.0.3.1']), /already assigned/)
  })

  it('rejects a non-array input', function () {
    assert.throws(() => networkManager.validateAliasList('x'), /Invalid aliases list/)
  })
})
