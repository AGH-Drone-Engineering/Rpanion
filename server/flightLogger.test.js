process.env.NODE_ENV = 'development'

const assert = require('assert')
const Path = require('path')
const fs = require('fs')
const os = require('os')
const logpaths = require('./paths.js')

const testRoot = fs.mkdtempSync(Path.join(os.tmpdir(), 'flightlogger-test-'))
logpaths.logsDir = Path.join(testRoot, 'logs')
logpaths.tlogDir = Path.join(testRoot, 'logs', 'telemetry')
logpaths.binDir = Path.join(testRoot, 'logs', 'bin')
logpaths.kmzDir = Path.join(testRoot, 'logs', 'kmz')
logpaths.terminalLogDir = Path.join(testRoot, 'logs', 'terminal')
logpaths.mediaDir = Path.join(testRoot, 'logs', 'media')

const Logger = require('./flightLogger')

describe('Logging Functions', function () {
  beforeEach('Ensure cleared log folder', function () {
    fs.rmSync(logpaths.logsDir, { recursive: true, force: true })
  })

  after(function () {
    fs.rmSync(testRoot, { recursive: true, force: true })
  })

  it('#loggerinit()', function () {
    const Lgr = new Logger()

    // assert folders were created
    assert.ok(fs.existsSync(logpaths.tlogDir))
    assert.ok(fs.existsSync(logpaths.binDir))
    assert.ok(fs.existsSync(logpaths.kmzDir))
    assert.ok(fs.existsSync(logpaths.terminalLogDir))
    assert.ok(fs.existsSync(logpaths.mediaDir))
    assert.ok(Lgr)
  })

  it('#clearlogfiles()', function () {
    const Lgr = new Logger()

    fs.writeFileSync(Path.join(logpaths.tlogDir, 'flight.tlog'), Buffer.from('tést'))
    fs.writeFileSync(Path.join(logpaths.binDir, 'flight.bin'), Buffer.from('tést'))
    fs.writeFileSync(Path.join(logpaths.kmzDir, 'flight.kmz'), Buffer.from('dummy'))

    assert.deepEqual(Lgr.clearlogs('tlog', []), { deleted: 1, skipped: 0 })
    assert.deepEqual(Lgr.clearlogs('binlog', []), { deleted: 1, skipped: 0 })
    assert.deepEqual(Lgr.clearlogs('kmzlog', []), { deleted: 1, skipped: 0 })

    assert.equal(fs.readdirSync(logpaths.tlogDir).length, 0)
    assert.equal(fs.readdirSync(logpaths.binDir).length, 0)
    assert.equal(fs.readdirSync(logpaths.kmzDir).length, 0)
  })

  it('#clearlogs keeps active files and type folders', function () {
    const Lgr = new Logger()
    const activeTlog = Path.join(logpaths.tlogDir, 'active.tlog')
    const activeBin = Path.join(logpaths.binDir, 'active.bin')
    fs.writeFileSync(activeTlog, 'a')
    fs.writeFileSync(Path.join(logpaths.tlogDir, 'old.tlog'), 'a')
    fs.writeFileSync(Path.join(logpaths.tlogDir, 'notes.txt'), 'a')
    fs.writeFileSync(activeBin, 'a')

    assert.deepEqual(Lgr.clearlogs('tlog', [activeTlog, activeBin]), { deleted: 1, skipped: 1 })
    assert.deepEqual(fs.readdirSync(logpaths.tlogDir).sort(), ['active.tlog', 'notes.txt'])
    assert.deepEqual(Lgr.clearlogs('binlog', [activeTlog, activeBin]), { deleted: 0, skipped: 1 })
    assert.ok(fs.existsSync(activeBin))
    assert.ok(fs.existsSync(logpaths.kmzDir))

    Lgr.clearlogs('kmzlog', [])
    Lgr.clearlogs('media', [])
    assert.ok(fs.existsSync(logpaths.kmzDir))
    assert.ok(fs.existsSync(logpaths.mediaDir))
  })

  it('#clearlogs removes media subfolders but keeps media folder', function () {
    const Lgr = new Logger()
    fs.mkdirSync(Path.join(logpaths.mediaDir, 'sub'))
    fs.writeFileSync(Path.join(logpaths.mediaDir, 'sub', 'a.jpg'), 'a')
    assert.deepEqual(Lgr.clearlogs('media', []), { deleted: 1, skipped: 0 })
    assert.deepEqual(fs.readdirSync(logpaths.mediaDir), [])
  })

  it('#getlogs()', function (done) {
    const Lgr = new Logger()
    fs.mkdirSync(Path.join(logpaths.mediaDir, 'sub'))
    fs.writeFileSync(Path.join(logpaths.mediaDir, 'sub', 'a.jpg'), 'a')
    fs.writeFileSync(Path.join(logpaths.tlogDir, 'flight.tlog'), Buffer.from('tést'))

    Lgr.getLogs(function (err, tlogs, binlogs, kmzlogs, mediafiles) {
      assert.equal(tlogs.length, 1)
      assert.equal(tlogs[0].key, 'flight.tlog')
      assert.equal(binlogs.length, 0)
      assert.equal(kmzlogs.length, 0)
      assert.equal(mediafiles.length, 1)
      assert.equal(mediafiles[0].key, Path.join('sub', 'a.jpg'))
      done()
    })
  })

  it('#getlogs() with missing folders returns empty lists', function (done) {
    const Lgr = new Logger()
    fs.rmSync(logpaths.logsDir, { recursive: true, force: true })

    Lgr.getLogs(function (err, tlogs, binlogs, kmzlogs, mediafiles) {
      assert.deepEqual([tlogs, binlogs, kmzlogs, mediafiles], [[], [], [], []])
      assert.deepEqual(Lgr.clearlogs('tlog', []), { deleted: 0, skipped: 0 })
      done()
    })
  })
})
