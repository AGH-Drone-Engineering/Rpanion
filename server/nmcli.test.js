const assert = require('assert')
const { parseTerseRow, parseMultiline } = require('./nmcli')
const nmcli = require('./nmcli')

describe('nmcli parsers', function () {
  it('parseTerseRow splits on unescaped colons and unescapes values', function () {
    assert.deepStrictEqual(parseTerseRow('My\\:Net:7c39cc41-3f26:802-11-wireless:wlan0'), ['My:Net', '7c39cc41-3f26', '802-11-wireless', 'wlan0'])
    assert.deepStrictEqual(parseTerseRow('back\\\\slash::x'), ['back\\slash', '', 'x'])
    assert.deepStrictEqual(parseTerseRow('plain'), ['plain'])
  })

  it('parseMultiline groups key:value lines into records starting at startKey', function () {
    const out = [
      'connection.id:Ethernet-Server',
      'ipv4.method:shared',
      'ipv4.addresses:10.0.3.1/24',
      '',
      'connection.id:My:Net',
      'ipv4.method:auto',
      'ipv4.addresses:'
    ].join('\n')
    assert.deepStrictEqual(parseMultiline(out, 'connection.id'), [
      { 'connection.id': 'Ethernet-Server', 'ipv4.method': 'shared', 'ipv4.addresses': '10.0.3.1/24' },
      { 'connection.id': 'My:Net', 'ipv4.method': 'auto', 'ipv4.addresses': '' }
    ])
  })

  describe('nmcli.run', function () {
    it('resolves stdout of a successful call', async function () {
      const out = await nmcli.run(['--version'])
      assert.ok(/nmcli/.test(out))
    })

    it('rejects with stderr text on non-zero exit', async function () {
      await assert.rejects(nmcli.run(['connection', 'show', 'rpanion-no-such-profile']), /no such connection profile/)
    })
  })
})
