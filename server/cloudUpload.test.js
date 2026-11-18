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

  it('#cloudsyncnow() starts root, kmz and media syncs and skips those still running', function () {
    settings.clear()
    const cloudVar = new CloudTest(settings)
    clearInterval(cloudVar.intervalObj)
    cloudVar.setSettingsBin(true, true, true, 'user@host:/dest', false, false, false)
    const calls = []
    cloudVar.runRsync = (source, destination, protectedPaths) => {
      calls.push([source, destination, protectedPaths])
      return { exitCode: null }
    }
    cloudVar.syncNow()
    assert.deepEqual(calls, [
      [cloudVar.logSources, 'user@host:/dest', ['media/', 'kmzlogs/']],
      [logpaths.kmzDir, 'user@host:/dest/kmzlogs', []],
      [logpaths.mediaDir, 'user@host:/dest/media', []]
    ])
    cloudVar.syncNow()
    assert.equal(calls.length, 3)
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

    it('#logs upload merges telemetry and bin logs into the destination root', function () {
      const cloudVar = make(false)
      assert.deepEqual(cloudVar.logSources, [logpaths.tlogDir, logpaths.binDir])
      const args = cloudVar.buildRsyncArgs(cloudVar.logSources, 'user@host:/dest', ['media/', 'kmzlogs/'])
      assert.ok(!args.some(a => a.startsWith('--include')))
      assert.ok(!args.includes('--delete'))
      assert.ok(!args.some(a => a.startsWith('--filter')))
      assert.deepEqual(args.slice(-3), [logpaths.tlogDir + '/', logpaths.binDir + '/', 'user@host:/dest'])
    })

    it('#delete keeps the remote media and kmzlogs folders when syncing the root', function () {
      const cloudVar = make(true)
      const args = cloudVar.buildRsyncArgs(cloudVar.logSources, 'user@host:/dest', ['media/', 'kmzlogs/'])
      assert.ok(args.includes('--delete'))
      assert.ok(args.includes('--filter=P media/'))
      assert.ok(args.includes('--filter=P kmzlogs/'))
    })

    it('#kmz upload goes to the kmzlogs subfolder', function () {
      const cloudVar = make(true)
      assert.equal(cloudVar.kmzFolder, logpaths.kmzDir)
      const args = cloudVar.buildRsyncArgs(cloudVar.kmzFolder, 'user@host:/dest/kmzlogs', [])
      assert.ok(args.includes('--delete'))
      assert.ok(!args.some(a => a.startsWith('--filter')))
      assert.deepEqual(args.slice(-2), [logpaths.kmzDir + '/', 'user@host:/dest/kmzlogs'])
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
