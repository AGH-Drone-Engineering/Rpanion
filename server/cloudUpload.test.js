const assert = require('assert')
const settings = require('settings-store')
const CloudTest = require('./cloudUpload')
const logpaths = require('./paths.js')

describe('Cloud Upload Functions', function () {
  it('#cloudinit()', function () {
    settings.clear()
    const cloudVar = new CloudTest(settings)

    // check initial status
    assert.equal(cloudVar.options.uploadEnabled, false)
    assert.equal(cloudVar.options.syncDeletions, false)

    clearInterval(cloudVar.intervalObj)
  })

  it('#cloudlocalupload()', function () {
    // Getting starting client with local copy
    settings.clear()
    const cloudVar = new CloudTest(settings)

    // check initial status
    assert.equal(cloudVar.options.uploadEnabled, false)
    assert.equal(cloudVar.conStatusStr(), 'Disabled')

    cloudVar.setSettingsBin(true, true, true, 'tmpfolder', false, false, false)

    assert.equal(cloudVar.conStatusStr(), 'Waiting for first run')
    assert.equal(cloudVar.options.uploadEnabled, true)
    assert.equal(cloudVar.options.uploadLogs, true)
    assert.equal(cloudVar.options.uploadMedia, true)

    clearInterval(cloudVar.intervalObj)
  })

  it('#cloudpausedwhenarmed()', function () {
    settings.clear()
    const fcManager = { m: { statusArmed: 1, conStatusInt: () => 1 } }
    const cloudVar = new CloudTest(settings, fcManager)

    cloudVar.setSettingsBin(true, true, true, 'tmpfolder', false, false, true)
    assert.equal(cloudVar.conStatusStr(), 'Paused - vehicle armed')

    fcManager.m.statusArmed = 0
    assert.equal(cloudVar.conStatusStr(), 'Waiting for first run')

    clearInterval(cloudVar.intervalObj)
  })

  it('#cloudpausedwhenunknown()', function () {
    // "Only upload while disarmed" must treat an unknown vehicle state (no
    // live telemetry) as unsafe, not assume disarmed.
    settings.clear()
    const cloudVar = new CloudTest(settings) // no fcManager - state is unknown

    cloudVar.setSettingsBin(true, true, true, 'tmpfolder', false, false, true)
    assert.equal(cloudVar.getVehicleArmedState(), 'unknown')
    assert.equal(cloudVar.conStatusStr(), 'Paused - vehicle state unknown')

    clearInterval(cloudVar.intervalObj)
  })

  it('#cloudsyncnownodest()', function () {
    // syncNow() should be a no-op with no destination configured
    settings.clear()
    const cloudVar = new CloudTest(settings)

    cloudVar.syncNow()
    assert.equal(cloudVar.rsyncPidLogs, null)
    assert.equal(cloudVar.rsyncPidMedia, null)

    clearInterval(cloudVar.intervalObj)
  })

  it('#cloudstatusregardlessofenabled()', function () {
    // "Upload Now" can trigger a sync even while uploadEnabled is off, so
    // its status should be reported regardless of that setting
    settings.clear()
    const cloudVar = new CloudTest(settings)

    cloudVar.options.uploadLogs = true
    cloudVar.rsyncPidLogs = { exitCode: null }
    assert.equal(cloudVar.conStatusStr(), 'Running')

    clearInterval(cloudVar.intervalObj)
  })

  describe('rsync arguments', function () {
    function make (syncDeletions) {
      settings.clear()
      const cloudVar = new CloudTest(settings)
      cloudVar.setSettingsBin(true, true, true, 'user@host:/dest', syncDeletions, false, false)
      clearInterval(cloudVar.intervalObj)
      return cloudVar
    }

    it('#logs upload sends the bin folder without include patterns', function () {
      const cloudVar = make(false)
      assert.equal(cloudVar.logsFolder, logpaths.binDir)
      const args = cloudVar.buildRsyncArgs(cloudVar.logsFolder, 'user@host:/dest', ['media/'])
      assert.ok(!args.some(a => a.startsWith('--include')))
      assert.ok(!args.includes('--delete'))
      assert.deepEqual(args.slice(-2), [logpaths.binDir + '/', 'user@host:/dest'])
    })

    it('#delete keeps the remote media folder when syncing logs', function () {
      const cloudVar = make(true)
      const args = cloudVar.buildRsyncArgs(cloudVar.logsFolder, 'user@host:/dest', ['media/'])
      assert.ok(args.includes('--delete'))
      assert.ok(args.includes('--filter=P media/'))
    })

    it('#media upload goes to the media subfolder', function () {
      const cloudVar = make(true)
      assert.equal(cloudVar.mediaFolder, logpaths.mediaDir)
      const args = cloudVar.buildRsyncArgs(cloudVar.mediaFolder, 'user@host:/dest/media', [])
      assert.ok(args.includes('--delete'))
      assert.ok(!args.some(a => a.startsWith('--filter')))
    })
  })
})
