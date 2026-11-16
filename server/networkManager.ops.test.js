const assert = require('assert')
const sinon = require('sinon')
const nmcli = require('./nmcli')
const networkManager = require('./networkManager')

// Routes nmcli.run calls to handlers keyed by a substring of the joined args
function fakeNmcli (handlers) {
  const calls = []
  sinon.stub(nmcli, 'run').callsFake(async (args, opts = {}) => {
    const line = (opts.sudo ? 'sudo ' : '') + args.join(' ')
    calls.push(line)
    for (const [pattern, handler] of handlers) {
      if (line.includes(pattern)) return handler(line)
    }
    return ''
  })
  return calls
}

const UUID = '11111111-2222-3333-4444-555555555555'

describe('networkManager operations', function () {
  const fs = require('fs')
  const path = require('path')
  let stateDir

  beforeEach(function () {
    stateDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rpanion-wifi-'))
    process.env.RPANION_WIFI_STATE_DIR = stateDir
  })

  afterEach(function () {
    sinon.restore()
    delete process.env.RPANION_WIFI_STATE_DIR
    fs.rmSync(stateDir, { recursive: true, force: true })
  })

  describe('activateConnection', function () {
    it('brings the profile up before enabling autoconnect', async function () {
      const calls = fakeNmcli([['-g connection.id,connection.type', () => 'bajer\n802-11-wireless\n']])
      await networkManager.activateConnection(UUID)
      assert.deepStrictEqual(calls, [
        `-g connection.id,connection.type connection show ${UUID}`,
        `sudo connection up ${UUID}`,
        `sudo connection mod ${UUID} connection.autoconnect yes`
      ])
    })

    it('keeps autoconnect off for the access point profile', async function () {
      const calls = fakeNmcli([['-g connection.id,connection.type', () => 'WiFiAP\n802-11-wireless\n']])
      await networkManager.activateConnection(UUID)
      assert.strictEqual(calls[2], `sudo connection mod ${UUID} connection.autoconnect no`)
    })

    it('holds the access point after the user activates it', async function () {
      fakeNmcli([['-g connection.id,connection.type', () => 'WiFiAP\n802-11-wireless\n']])
      await networkManager.activateConnection(UUID)
      assert.ok(fs.existsSync(path.join(stateDir, 'manual-hold')))
    })

    it('releases the hold when a client profile is activated', async function () {
      fs.writeFileSync(path.join(stateDir, 'manual-hold'), '')
      fakeNmcli([['-g connection.id,connection.type', () => 'bajer\n802-11-wireless\n']])
      await networkManager.activateConnection(UUID)
      assert.ok(!fs.existsSync(path.join(stateDir, 'manual-hold')))
    })

    it('fails without changes when the profile lookup fails', async function () {
      const calls = fakeNmcli([['-g connection.id', () => { throw new Error('no such connection profile') }]])
      await assert.rejects(networkManager.activateConnection(UUID), /no such connection profile/)
      assert.ok(calls.every(c => !c.startsWith('sudo')))
    })

    it('rolls back to the access point when a Wi-Fi client fails', async function () {
      const calls = fakeNmcli([
        ['-g connection.id,connection.type', () => 'bajer\n802-11-wireless\n'],
        [`sudo connection up ${UUID}`, () => { throw new Error('Secrets were required') }]
      ])
      await assert.rejects(networkManager.activateConnection(UUID), /Secrets were required/)
      assert.ok(calls.includes('sudo connection up WiFiAP'))
      assert.ok(!calls.some(c => c.includes('autoconnect')))
    })

    it('rolls back to Ethernet-Server and explains a DHCP timeout', async function () {
      const calls = fakeNmcli([
        ['-g connection.id,connection.type', () => 'Ethernet-Client\n802-3-ethernet\n'],
        [`sudo connection up ${UUID}`, () => { throw new Error('IP configuration could not be reserved (no available address, timeout, etc.)') }]
      ])
      await assert.rejects(networkManager.activateConnection(UUID), /DHCP timeout/)
      assert.ok(calls.includes('sudo connection up Ethernet-Server'))
    })

    it('does not roll back when Ethernet-Server itself fails', async function () {
      const calls = fakeNmcli([
        ['-g connection.id,connection.type', () => 'Ethernet-Server\n802-3-ethernet\n'],
        [`sudo connection up ${UUID}`, () => { throw new Error('failed') }]
      ])
      await assert.rejects(networkManager.activateConnection(UUID))
      assert.strictEqual(calls.filter(c => c.startsWith('sudo connection up')).length, 1)
    })
  })

  describe('deactivateConnection / deleteConnection', function () {
    for (const name of ['Ethernet-Server', 'WiFiAP']) {
      it(`refuses to deactivate ${name}`, async function () {
        const calls = fakeNmcli([['-g connection.id,connection.type', () => `${name}\nx\n`]])
        await assert.rejects(networkManager.deactivateConnection(UUID), /fallback profile/)
        assert.ok(calls.every(c => !c.startsWith('sudo')))
      })
    }

    for (const name of ['Ethernet-Server', 'Ethernet-Client', 'WiFiAP']) {
      it(`refuses to delete ${name}`, async function () {
        const calls = fakeNmcli([['-g connection.id,connection.type', () => `${name}\nx\n`]])
        await assert.rejects(networkManager.deleteConnection(UUID), /system profile/)
        assert.ok(calls.every(c => !c.startsWith('sudo')))
      })
    }

    it('deactivate fails without changes when the lookup fails', async function () {
      const calls = fakeNmcli([['-g connection.id', () => { throw new Error('nmcli down') }]])
      await assert.rejects(networkManager.deactivateConnection(UUID))
      assert.ok(calls.every(c => !c.startsWith('sudo')))
    })
  })

  describe('editConnection', function () {
    it('reports a failed re-activation of an active profile', async function () {
      fakeNmcli([
        ['-g connection.id,connection.type', () => 'bajer\n802-11-wireless\n'],
        ['GENERAL.STATE', () => 'GENERAL.STATE:activated\n'],
        [`sudo connection up ${UUID}`, () => { throw new Error('Secrets were required') }]
      ])
      await assert.rejects(networkManager.editConnection(UUID, { ipaddresstype: 'auto', mode: 'infrastructure', ssid: 'bajer' }), /re-activation failed.*Secrets/)
    })

    it('does not re-activate an inactive profile', async function () {
      const calls = fakeNmcli([['-g connection.id,connection.type', () => 'other\n802-3-ethernet\n']])
      await networkManager.editConnection(UUID, { ipaddresstype: 'manual', ipaddress: '10.9.9.2', subnet: '255.255.255.0' })
      assert.ok(calls.includes(`sudo connection mod ${UUID} ipv4.addresses 10.9.9.2/24 ipv4.method manual`))
      assert.ok(!calls.some(c => c.startsWith('sudo connection up')))
    })

    it('refuses to change the IP mode of Ethernet-Server', async function () {
      const calls = fakeNmcli([['-g connection.id,connection.type', () => 'Ethernet-Server\n802-3-ethernet\n']])
      await assert.rejects(networkManager.editConnection(UUID, { ipaddresstype: 'auto' }), /fallback profile/)
      assert.ok(calls.every(c => !c.startsWith('sudo')))
    })
  })

  describe('addConnection', function () {
    it('returns the UUID printed by nmcli connection add', async function () {
      fakeNmcli([['sudo connection add', () => `Connection 'x' (${UUID}) successfully added.\n`]])
      const uuid = await networkManager.addConnection('x', 'ethernet', 'eth0', { ipaddresstype: 'auto' })
      assert.strictEqual(uuid, UUID)
    })
  })

  describe('getConnections', function () {
    it('parses escaped names and adds roles', async function () {
      fakeNmcli([
        ['-t -f NAME,UUID,TYPE,DEVICE', () => `My\\:Net:${UUID}:802-11-wireless:wlan0\nEthernet-Server:aaaaaaaa-0000-0000-0000-000000000000:802-3-ethernet:\n`],
        ['connection.uuid,connection.interface-name', () => `connection.uuid:${UUID}\nconnection.interface-name:wlan0\n`]
      ])
      const list = await networkManager.getConnections()
      assert.deepStrictEqual(list[0], { value: UUID, label: '', labelPre: 'My:Net', type: '802-11-wireless', state: 'wlan0', attachedIface: 'wlan0', role: null })
      assert.strictEqual(list[1].role, 'ethernet-server')
      assert.strictEqual(list[1].state, '')
    })
  })

  describe('error status', function () {
    it('marks refusals of system profiles as 409', async function () {
      fakeNmcli([['-g connection.id,connection.type', () => 'WiFiAP\nx\n']])
      await assert.rejects(networkManager.deactivateConnection(UUID), (err) => err.status === 409)
    })

    it('marks address conflicts as 409 and invalid addresses as 422', async function () {
      fakeNmcli([])
      networkManager.setStaticAddressGuard(() => 'overlaps PPP')
      await assert.rejects(networkManager.addConnection('x', 'ethernet', 'eth0', { ipaddresstype: 'manual', ipaddress: '10.1.1.1', subnet: '255.255.255.0' }), (err) => err.status === 409)
      networkManager.setStaticAddressGuard(null)
      await assert.rejects(networkManager.addConnection('x', 'ethernet', 'eth0', { ipaddresstype: 'manual', ipaddress: '10.1.1.1', subnet: '255.0.255.0' }), (err) => err.status === 422)
      await assert.rejects(networkManager.setEthernetAliases([{ ip: 'x' }]), (err) => err.status === 422)
    })
  })
})
