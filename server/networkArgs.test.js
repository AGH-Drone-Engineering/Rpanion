const assert = require('assert')
const { parseIwChannels } = require('./networkArgs')

const IW_SAMPLE = [
  'Wiphy phy0',
  '\tBand 1:',
  '\t\tFrequencies:',
  '\t\t\t* 2412.0 MHz [1] (20.0 dBm)',
  '\t\t\t* 2472.0 MHz [13] (20.0 dBm)',
  '\t\t\t* 2484.0 MHz [14] (disabled)',
  '\tBand 2:',
  '\t\tFrequencies:',
  '\t\t\t* 5170.0 MHz [34] (disabled)',
  '\t\t\t* 5180.0 MHz [36] (20.0 dBm)',
  '\t\t\t* 5260.0 MHz [52] (20.0 dBm) (no IR, radar detection)',
  '\t\t\t* 5180.0 MHz [36] (20.0 dBm)',
  '\tSupported commands:',
  '\t\t * new_interface'
].join('\n')

describe('parseIwChannels', function () {
  it('returns enabled channels with band', function () {
    assert.deepStrictEqual(parseIwChannels(IW_SAMPLE), [
      { value: 1, freq: '2412.0', label: '1 (2412.0 MHz)', band: 'bg' },
      { value: 13, freq: '2472.0', label: '13 (2472.0 MHz)', band: 'bg' },
      { value: 36, freq: '5180.0', label: '36 (5180.0 MHz)', band: 'a' },
      { value: 52, freq: '5260.0', label: '52 (5260.0 MHz)', band: 'a' }
    ])
  })

  it('returns an empty list for empty input', function () {
    assert.deepStrictEqual(parseIwChannels(''), [])
  })
})

describe('buildIpv4Args', function () {
  const { buildIpv4Args } = require('./networkArgs')

  it('manual address with netmask', function () {
    assert.deepStrictEqual(buildIpv4Args({ ipaddresstype: 'manual', ipaddress: '192.168.144.20', subnet: '255.255.255.0' }), {
      args: ['ipv4.addresses', '192.168.144.20/24', 'ipv4.method', 'manual'],
      address: { ip: '192.168.144.20', prefix: 24 }
    })
  })

  it('shared address keeps the given prefix', function () {
    assert.deepStrictEqual(buildIpv4Args({ ipaddresstype: 'shared', ipaddress: '10.0.3.1', subnet: '255.255.0.0' }).args,
      ['ipv4.addresses', '10.0.3.1/16', 'ipv4.method', 'shared'])
  })

  it('dhcp clears addresses only on edit', function () {
    assert.deepStrictEqual(buildIpv4Args({ ipaddresstype: 'auto' }, { isNew: true }), { args: ['ipv4.method', 'auto'], address: null })
    assert.deepStrictEqual(buildIpv4Args({ ipaddresstype: 'auto' }).args, ['ipv4.method', 'auto', 'ipv4.addresses', ''])
  })

  it('access point is shared with /24', function () {
    assert.deepStrictEqual(buildIpv4Args({ mode: 'ap', ipaddress: '10.0.2.100' }), {
      args: ['ipv4.addresses', '10.0.2.100/24', 'ipv4.method', 'shared'],
      address: { ip: '10.0.2.100', prefix: 24 }
    })
    assert.deepStrictEqual(buildIpv4Args({ mode: 'ap' }, { isNew: true }).args, ['ipv4.method', 'shared'])
  })

  it('manual without address changes nothing', function () {
    assert.deepStrictEqual(buildIpv4Args({ ipaddresstype: 'manual' }), { args: [], address: null })
  })

  it('rejects invalid netmask instead of defaulting to /24', function () {
    assert.throws(() => buildIpv4Args({ ipaddresstype: 'manual', ipaddress: '10.1.1.1', subnet: '0.0.0.0' }), /Invalid IP address or netmask/)
    assert.throws(() => buildIpv4Args({ ipaddresstype: 'manual', ipaddress: '10.1.1.1', subnet: '255.0.255.0' }), /Invalid IP address or netmask/)
  })
})

describe('buildWifiArgs', function () {
  const { buildWifiArgs } = require('./networkArgs')
  const AP_SECURITY = ['802-11-wireless-security.key-mgmt', 'wpa-psk', '802-11-wireless-security.psk', 'secret123',
    '802-11-wireless-security.proto', 'rsn', '802-11-wireless-security.pairwise', 'ccmp',
    '802-11-wireless-security.group', 'ccmp', '802-11-wireless-security.wps-method', '1']

  it('access point add and edit use the same security settings', function () {
    const ap = { mode: 'ap', ssid: 'rpanion', band: 'bg', channel: '6', wpaType: 'wpa-psk', password: 'secret123' }
    const expected = ['802-11-wireless.ssid', 'rpanion', '802-11-wireless.mode', 'ap', '802-11-wireless.band', 'bg',
      '802-11-wireless.channel', '6', ...AP_SECURITY]
    assert.deepStrictEqual(buildWifiArgs(ap, { isNew: true }), expected)
    assert.deepStrictEqual(buildWifiArgs(ap), expected)
  })

  it('auto channel is omitted on add and cleared on edit', function () {
    const ap = { mode: 'ap', ssid: 'x', band: 'a', channel: '0', wpaType: 'none' }
    assert.ok(!buildWifiArgs(ap, { isNew: true }).includes('802-11-wireless.channel'))
    const edit = buildWifiArgs(ap)
    assert.strictEqual(edit[edit.indexOf('802-11-wireless.channel') + 1], '')
  })

  it('client edit without password keeps the stored psk and does not force ccmp', function () {
    assert.deepStrictEqual(buildWifiArgs({ mode: 'infrastructure', ssid: 'home', wpaType: 'wpa-psk' }),
      ['802-11-wireless.ssid', 'home', '802-11-wireless.mode', 'infrastructure', '802-11-wireless-security.key-mgmt', 'wpa-psk'])
  })

  it('client add with password sets psk', function () {
    assert.deepStrictEqual(buildWifiArgs({ mode: 'infrastructure', ssid: 'home', wpaType: 'wpa-psk', password: 'pw123456' }, { isNew: true }),
      ['802-11-wireless.ssid', 'home', '802-11-wireless.mode', 'infrastructure', '802-11-wireless-security.key-mgmt', 'wpa-psk', '802-11-wireless-security.psk', 'pw123456'])
  })

  it('open network sets no security properties', function () {
    assert.deepStrictEqual(buildWifiArgs({ mode: 'infrastructure', ssid: 'open', wpaType: 'none' }, { isNew: true }),
      ['802-11-wireless.ssid', 'open', '802-11-wireless.mode', 'infrastructure'])
  })
})
