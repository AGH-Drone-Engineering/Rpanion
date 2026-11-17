const assert = require('assert')
const { createTerminalSystem } = require('./terminalSystem')

function files (map) {
  return async (file) => {
    if (!(file in map)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return map[file]
  }
}

const PATHS = {
  controllers: '/r/controllers',
  sliceDir: '/r/slice'
}

function make (map, execFile = () => {}) {
  return createTerminalSystem({ execFile, readFile: files(map), paths: PATHS })
}

describe('terminalSystem', function () {
  it('getStats() reads the slice counters', async function () {
    const system = make({
      '/r/controllers': 'cpuset cpu io memory pids\n',
      '/r/slice/memory.stat': 'anon 1048576\nfile 4096\n',
      '/r/slice/memory.max': '5000000000\n',
      '/r/slice/memory.events': 'low 0\nhigh 0\nmax 0\noom 1\noom_kill 1\n',
      '/r/slice/cpu.stat': 'usage_usec 123456\nuser_usec 100\n'
    })
    const stats = await system.getStats()
    assert.deepStrictEqual(stats.memory, { controller: true, anonBytes: 1048576, maxBytes: 5000000000, totalBytes: require('os').totalmem(), oomKills: 1 })
    assert.deepStrictEqual(stats.cpu, { usageUsec: 123456, cores: require('os').cpus().length })
    assert.strictEqual(stats.reserve, undefined)
  })

  it('getStats() without the memory controller', async function () {
    const system = make({
      '/r/controllers': 'cpuset cpu io pids\n',
      '/r/slice/cpu.stat': 'usage_usec 5\n'
    })
    const stats = await system.getStats()
    assert.deepStrictEqual(stats.memory, { controller: false, anonBytes: null, maxBytes: null, totalBytes: require('os').totalmem(), oomKills: null })
  })

  it('getStats() treats max as no limit', async function () {
    const system = make({
      '/r/controllers': 'memory\n',
      '/r/slice/memory.stat': 'anon 10\n',
      '/r/slice/memory.max': 'max\n'
    })
    assert.strictEqual((await system.getStats()).memory.maxBytes, null)
  })

  it('getActiveState() parses systemctl show', async function () {
    const calls = []
    const system = make({}, (cmd, args, cb) => { calls.push([cmd, ...args]); cb(null, 'LoadState=loaded\nActiveState=deactivating\n', '') })
    assert.deepStrictEqual(await system.getActiveState(), { installed: true, activeState: 'deactivating' })
    assert.deepStrictEqual(calls[0], ['systemctl', 'show', '-p', 'ActiveState', '-p', 'LoadState', 'rpanion-terminal'])
  })

  it('getActiveState() reports a missing unit', async function () {
    const system = make({}, (cmd, args, cb) => cb(null, 'LoadState=not-found\nActiveState=inactive\n', ''))
    assert.deepStrictEqual(await system.getActiveState(), { installed: false, activeState: 'inactive' })
    const broken = make({}, (cmd, args, cb) => cb(new Error('no systemd'), '', ''))
    assert.deepStrictEqual(await broken.getActiveState(), { installed: false, activeState: 'unknown' })
  })

  it('start() and stop() use the exact sudoers commands', async function () {
    const calls = []
    const system = make({}, (cmd, args, cb) => { calls.push([cmd, ...args]); cb(null, '', '') })
    await system.start()
    await system.stop()
    assert.deepStrictEqual(calls, [
      ['sudo', '-n', '/usr/bin/systemctl', 'start', 'rpanion-terminal'],
      ['sudo', '-n', '/usr/bin/systemctl', 'stop', '--no-block', 'rpanion-terminal']
    ])
  })

  it('start() rejects with the sudo message', async function () {
    const system = make({}, (cmd, args, cb) => cb(new Error('exit 1'), '', 'sudo: a password is required\n'))
    await assert.rejects(system.start(), /a password is required/)
  })
})
