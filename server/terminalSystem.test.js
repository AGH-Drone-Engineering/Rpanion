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

  describe('tmux commands', function () {
    const PREFIX = ['sudo', '-n', '-u', '#1000', '/usr/bin/tmux', '-N', '-S', '/run/rpanion-terminal/tmux.sock']
    const SESSION = 'web-0123456789ab'

    function recorder (stdout = '') {
      const calls = []
      const execFile = (cmd, args, cb) => { calls.push([cmd, ...args]); cb(null, stdout, '') }
      return { calls, system: make({}, execFile) }
    }

    it('listWindows() parses the windows of a session ordered by index', async function () {
      const { calls, system } = recorder('@4\t2\t0\thtop\n@0\t0\t1\tbash\n@7\t1\t0\ta\tb\x01c\nbroken\n\n')
      assert.deepStrictEqual(await system.listWindows(SESSION), [
        { id: '@0', index: 0, name: 'bash', active: true },
        { id: '@7', index: 1, name: 'a b c', active: false },
        { id: '@4', index: 2, name: 'htop', active: false }
      ])
      assert.deepStrictEqual(calls, [[...PREFIX, 'list-windows', '-t', `${SESSION}:`, '-F', '#{window_id}\t#{window_index}\t#{window_active}\t#{window_name}']])
    })

    it('uses the fixed tmux commands for window operations', async function () {
      const { calls, system } = recorder()
      await system.newWindow(SESSION)
      await system.killWindow('@12')
      await system.selectWindow(SESSION, '@3')
      assert.deepStrictEqual(calls, [
        [...PREFIX, 'new-window', '-t', `${SESSION}:`, '-c', '~'],
        [...PREFIX, 'kill-window', '-t', '@12'],
        [...PREFIX, 'select-window', '-t', `${SESSION}:@3`]
      ])
    })

    it('renameWindow() keeps # literal, ends options with -- and resets to automatic naming', async function () {
      const { calls, system } = recorder()
      await system.renameWindow('@2', '-cam #1 #{pane_pid}')
      await system.renameWindow('@2', '')
      assert.deepStrictEqual(calls, [
        [...PREFIX, 'rename-window', '-t', '@2', '--', '-cam ##1 ##{pane_pid}'],
        [...PREFIX, 'set-window-option', '-t', '@2', 'automatic-rename', 'on']
      ])
      await assert.rejects(system.renameWindow('@2;x', 'a'), /Invalid window id/)
    })

    it('rejects session names and window ids that were not generated by the server', async function () {
      const { calls, system } = recorder()
      for (const name of ['main', 'web-', 'web-0123456789abc', 'web-0123456789AB', '-t', 'web-0123456789ab;', undefined]) {
        await assert.rejects(system.listWindows(name), /Invalid session name/)
        await assert.rejects(system.newWindow(name), /Invalid session name/)
        await assert.rejects(system.selectWindow(name, '@1'), /Invalid session name/)
      }
      for (const id of ['1', '@', '@a', '@1 ', '-a', '@1;x', undefined, 5]) {
        await assert.rejects(system.killWindow(id), /Invalid window id/)
        await assert.rejects(system.selectWindow(SESSION, id), /Invalid window id/)
      }
      assert.deepStrictEqual(calls, [])
    })

    it('ensureMainSession() creates main detached and tolerates a concurrent creation', async function () {
      const { calls, system } = recorder()
      await system.ensureMainSession()
      assert.deepStrictEqual(calls, [[...PREFIX, 'new-session', '-d', '-s', 'main', '-c', '~']])
      const racing = make({}, (cmd, args, cb) => cb(new Error('exit 1'), '', 'duplicate session: main\n'))
      await racing.ensureMainSession()
      const broken = make({}, (cmd, args, cb) => cb(new Error('exit 1'), '', 'no server running\n'))
      await assert.rejects(broken.ensureMainSession(), /no server running/)
    })
  })
})
