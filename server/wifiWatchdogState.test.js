const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const wifiWatchdogState = require('./wifiWatchdogState')

describe('wifiWatchdogState', function () {
  let dir
  let configFile

  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpanion-wifi-'))
    configFile = path.join(dir, 'rpanion-wifi.conf')
    process.env.RPANION_WIFI_STATE_DIR = dir
    process.env.RPANION_WIFI_CONFIG = configFile
  })

  afterEach(function () {
    delete process.env.RPANION_WIFI_STATE_DIR
    delete process.env.RPANION_WIFI_CONFIG
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reset() removes disconnect timer and manual hold, tolerates missing files', function () {
    fs.writeFileSync(path.join(dir, 'disconnect-time'), '123')
    fs.writeFileSync(path.join(dir, 'manual-hold'), '')
    wifiWatchdogState.reset()
    assert.strictEqual(fs.existsSync(path.join(dir, 'disconnect-time')), false)
    assert.strictEqual(fs.existsSync(path.join(dir, 'manual-hold')), false)
    wifiWatchdogState.reset()
  })

  it('setManualHold() creates and removes the hold flag', function () {
    wifiWatchdogState.setManualHold(true)
    assert.strictEqual(fs.existsSync(path.join(dir, 'manual-hold')), true)
    wifiWatchdogState.setManualHold(false)
    assert.strictEqual(fs.existsSync(path.join(dir, 'manual-hold')), false)
  })

  it('readConfig() defaults to auto-reconnect when the file is missing', function () {
    assert.deepStrictEqual(wifiWatchdogState.readConfig(), { apAutoReconnect: true })
  })

  it('writeConfig() round-trips through readConfig()', async function () {
    await wifiWatchdogState.writeConfig({ apAutoReconnect: false })
    assert.strictEqual(fs.readFileSync(configFile, 'utf8'), 'AP_AUTO_RECONNECT=false\n')
    assert.deepStrictEqual(wifiWatchdogState.readConfig(), { apAutoReconnect: false })
  })

  it('writeConfig() rejects when the file cannot be written', async function () {
    process.env.RPANION_WIFI_CONFIG = path.join(dir, 'missing-dir', 'x.conf')
    await assert.rejects(wifiWatchdogState.writeConfig({ apAutoReconnect: true }))
  })
})
