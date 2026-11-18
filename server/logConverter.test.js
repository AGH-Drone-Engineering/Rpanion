const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sinon = require('sinon')
const settings = require('settings-store')
const logpaths = require('./paths.js')
const LogConverter = require('./logConverter')

describe('Log converter events', function () {
  let tmp, savedKmzDir, clock, converter

  beforeEach(function () {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmz-'))
    savedKmzDir = logpaths.kmzDir
    logpaths.kmzDir = path.join(tmp, 'kmz')
    fs.mkdirSync(logpaths.kmzDir)
    clock = sinon.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(function () {
    if (converter) converter.quitting()
    clock.restore()
    sinon.restore()
    logpaths.kmzDir = savedKmzDir
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function run (scriptBody) {
    const script = path.join(tmp, 'python')
    fs.writeFileSync(script, scriptBody, { mode: 0o755 })
    sinon.stub(logpaths, 'getPythonPath').returns(script)
    settings.clear()
    converter = new LogConverter(settings)
    converter.options.doLogConversion = true
    const types = []
    converter.eventEmitter.on('logschanged', (t) => types.push(t))
    clock.tick(20000)
    return new Promise((resolve) => {
      converter.converterPid.on('close', () => setImmediate(() => resolve(types)))
    })
  }

  it('emits kmz when a run produced files', async function () {
    const types = await run(`#!/bin/sh\ntouch "${path.join(tmp, 'kmz', 'a.kmz')}"\n`)
    assert.deepEqual(types, ['kmz'])
  })

  it('stays silent when a run produced nothing', async function () {
    const types = await run('#!/bin/sh\nexit 0\n')
    assert.deepEqual(types, [])
  })
})
