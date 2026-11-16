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
  it('#networkmanagergetAdapters()', async function () {
    const adapters = await networkManager.getAdapters()
    assert.ok(Array.isArray(adapters))
  })

  it('#networkmanagergetConnections()', async function () {
    const connections = await networkManager.getConnections()
    assert.ok(Array.isArray(connections))
  })

  it('#getWifiScan()', async function () {
    this.timeout(10000)
    const networks = await networkManager.getWifiScan()
    assert.equal(Array.isArray(networks), true)
  })

  describe('watchdog files', function () {
    const os = require('os')
    const path = require('path')
    let dir

    beforeEach(function () {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpanion-wifi-'))
      process.env.RPANION_WIFI_STATE_DIR = dir
      process.env.RPANION_WIFI_CONFIG = path.join(dir, 'rpanion-wifi.conf')
    })

    afterEach(function () {
      delete process.env.RPANION_WIFI_STATE_DIR
      delete process.env.RPANION_WIFI_CONFIG
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it('#resetWifiWatchdogState()', function () {
      const testFile = path.join(dir, 'disconnect-time')
      fs.writeFileSync(testFile, '123')
      networkManager.resetWifiWatchdogState()
      assert.equal(fs.existsSync(testFile), false)
    })

    it('#getWifiSettings() and #setWifiSettings()', async function () {
      const result = await networkManager.setWifiSettings({ apAutoReconnect: false })
      assert.equal(result.apAutoReconnect, false)
      assert.equal((await networkManager.getWifiSettings()).apAutoReconnect, false)
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

describe('static address guard', function () {
  const sinon = require('sinon')
  const nmcli = require('./nmcli')
  let calls

  beforeEach(function () {
    calls = []
    sinon.stub(nmcli, 'run').callsFake(async (args, opts = {}) => {
      calls.push([opts.sudo ? 'sudo' : 'nmcli', ...args])
      return ''
    })
    networkManager.setStaticAddressGuard((subnet) => subnet.ip.startsWith('192.168.144.') ? 'overlaps PPP' : null)
  })

  afterEach(function () {
    sinon.restore()
    networkManager.setStaticAddressGuard(null)
  })

  const sudoCalls = () => calls.filter(c => c[0] === 'sudo')

  it('addConnection rejects a conflicting address before running nmcli', async function () {
    await assert.rejects(networkManager.addConnection('x', 'ethernet', 'eth0', { ipaddresstype: 'manual', ipaddress: '192.168.144.20', subnet: '255.255.255.0' }), /overlaps PPP/)
    assert.strictEqual(calls.length, 0)
  })

  it('editConnection rejects a conflicting address before modifying the profile', async function () {
    await assert.rejects(networkManager.editConnection('00000000-0000-0000-0000-000000000000', { ipaddresstype: 'manual', ipaddress: '192.168.144.20', subnet: '255.255.255.0' }), /overlaps PPP/)
    assert.deepStrictEqual(sudoCalls(), [])
  })

  it('setEthernetAliases rejects a conflicting alias before writing or applying', async function () {
    await assert.rejects(networkManager.setEthernetAliases([{ ip: '192.168.144.30', subnet: '255.255.255.0' }]), /overlaps PPP/)
    assert.deepStrictEqual(sudoCalls(), [])
  })
})
