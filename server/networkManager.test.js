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
