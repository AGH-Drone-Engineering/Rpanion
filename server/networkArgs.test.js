const assert = require('assert')
const { parseIwChannels, buildIpv4Args, buildWifiArgs, PROFILE, profileRole, parseIwScan, parseNmcliWifiList, parseIpAddrShow } = require('./networkArgs')

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

  describe('buildIpv4Args', function () {
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

  describe('profile roles', function () {
    it('maps system profile names to roles', function () {
      assert.strictEqual(profileRole(PROFILE.ETH_CLIENT), 'ethernet-client')
      assert.strictEqual(profileRole('Ethernet-Server'), 'ethernet-server')
      assert.strictEqual(profileRole('WiFiAP'), 'wifi-ap')
      assert.strictEqual(profileRole('bajer'), null)
    })
  })

  describe('parseIwScan', function () {
    it('returns networks with percent signal, security and dedup by strongest', function () {
      const out = [
        'BSS aa:bb:cc:dd:ee:01(on wlan0)',
        '\tsignal: -50.00 dBm',
        '\tSSID: home',
        '\tRSN:\t * Version: 1',
        '\t\t * Authentication suites: PSK',
        'BSS aa:bb:cc:dd:ee:02(on wlan0)',
        '\tsignal: -80.00 dBm',
        '\tSSID: home',
        '\tRSN:\t * Version: 1',
        'BSS aa:bb:cc:dd:ee:03(on wlan0)',
        '\tsignal: -60.00 dBm',
        '\tSSID: modern',
        '\tRSN:\t * Version: 1',
        '\t\t * Authentication suites: SAE',
        'BSS aa:bb:cc:dd:ee:04(on wlan0)',
        '\tsignal: -40.00 dBm',
        '\tSSID: rpanion',
        'BSS aa:bb:cc:dd:ee:05(on wlan0)',
        '\tsignal: -70.00 dBm',
        '\tSSID: cafe'
      ].join('\n')
      assert.deepStrictEqual(parseIwScan(out, ['rpanion']), [
        { ssid: 'home', signal: 100, security: 'WPA2' },
        { ssid: 'modern', signal: 80, security: 'WPA3' },
        { ssid: 'cafe', signal: 60, security: 'Open' }
      ])
    })
  })

  describe('parseNmcliWifiList', function () {
    it('parses escaped terse rows and skips hidden/own SSIDs', function () {
      const out = 'My\\:Net:70:WPA2\n--:50:WPA2\nrpanion:90:WPA2\nopen:30:\nMy\\:Net:20:WPA2\nlab:60:WPA3 SAE\n'
      assert.deepStrictEqual(parseNmcliWifiList(out, ['rpanion']), [
        { ssid: 'My:Net', signal: 70, security: 'WPA2' },
        { ssid: 'lab', signal: 60, security: 'WPA3' },
        { ssid: 'open', signal: 30, security: 'Open' }
      ])
    })
  })

  describe('parseIpAddrShow', function () {
    it('parses `ip -o -4 addr show` lines', function () {
      const out = '1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever\n' +
        '2: eth0    inet 10.0.3.1/24 brd 10.0.3.255 scope global noprefixroute eth0\\       valid_lft forever\n' +
        '3: wlan0    inet 10.28.237.122/24 brd 10.28.237.255 scope global dynamic wlan0\\       valid_lft 3000sec\n'
      assert.deepStrictEqual(parseIpAddrShow(out), [
        { iface: 'lo', ip: '127.0.0.1', prefix: 8 },
        { iface: 'eth0', ip: '10.0.3.1', prefix: 24 },
        { iface: 'wlan0', ip: '10.28.237.122', prefix: 24 }
      ])
    })
  })
})
