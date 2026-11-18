const assert = require('assert')
const http = require('http')
const { Server } = require('socket.io')
const { io: ioClient } = require('socket.io-client')
const { createTerminal, MAX_CLIENTS, MAX_WINDOWS, HIGH_WATER, LOW_WATER } = require('./terminal')

function fakePty () {
  const terms = []
  return {
    terms,
    spawn (command, args, options) {
      const dataHandlers = []
      const exitHandlers = []
      const term = {
        command,
        args,
        options,
        written: [],
        resizes: [],
        kills: [],
        pauses: 0,
        resumes: 0,
        onData: (fn) => dataHandlers.push(fn),
        onExit: (fn) => exitHandlers.push(fn),
        write: (d) => term.written.push(d),
        resize: (c, r) => term.resizes.push([c, r]),
        kill: (sig) => term.kills.push(sig),
        pause: () => { term.pauses++ },
        resume: () => { term.resumes++ },
        emitData: (d) => dataHandlers.forEach(fn => fn(d)),
        emitExit: (exitCode) => exitHandlers.forEach(fn => fn({ exitCode }))
      }
      terms.push(term)
      return term
    }
  }
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor (condition, message, timeout = 2000) {
  const end = Date.now() + timeout
  while (!condition()) {
    if (Date.now() > end) assert.fail(`Timed out: ${message}`)
    await wait(10)
  }
}

describe('terminal relay', function () {
  let httpServer, io, terminal, port, pty, system, clients, authEnabled, user

  beforeEach(async function () {
    clients = []
    pty = fakePty()
    authEnabled = true
    user = undefined
    system = {
      activeState: 'active',
      installed: true,
      starts: 0,
      ensures: 0,
      calls: [],
      windows: [{ id: '@0', index: 0, name: 'bash', active: true }],
      getActiveState: async () => ({ installed: system.installed, activeState: system.activeState }),
      start: async () => { system.starts++; system.activeState = 'active' },
      ensureMainSession: async () => { system.ensures++ },
      listWindows: async (session) => {
        system.calls.push(['list', session])
        return system.windows.map(w => ({ ...w }))
      },
      newWindow: async (session) => {
        system.calls.push(['new', session])
        const next = system.windows.length ? Math.max(...system.windows.map(w => w.index)) + 1 : 0
        system.windows.push({ id: `@${next}`, index: next, name: 'bash', active: false })
      },
      killWindow: async (id) => {
        system.calls.push(['kill', id])
        system.windows = system.windows.filter(w => w.id !== id)
      },
      renameWindow: async (id, name) => {
        system.calls.push(['rename', id, name])
        system.windows.forEach(w => { if (w.id === id) w.name = name || 'bash' })
      },
      selectWindow: async (session, id) => {
        system.calls.push(['select', session, id])
        system.windows.forEach(w => { w.active = w.id === id })
      }
    }
    httpServer = http.createServer()
    io = new Server(httpServer, { cookie: false })
    // Stands in for the io.engine.use JWT check of index.js
    io.engine.use((req, res, next) => { if (user) req.user = user; next() })
    terminal = createTerminal({ io, system, isAuthEnabled: () => authEnabled, loadPty: () => pty })
    await new Promise(resolve => httpServer.listen(0, resolve))
    port = httpServer.address().port
  })

  afterEach(async function () {
    clients.forEach(c => c.close())
    terminal.closeAll()
    io.close()
    if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve))
  })

  function connect () {
    const socket = ioClient(`http://127.0.0.1:${port}/terminal`, { forceNew: true, transports: ['websocket'], reconnection: false })
    socket.states = []
    socket.outputs = []
    socket.exits = []
    socket.windowLists = []
    socket.windowErrors = []
    socket.on('windows', (w) => socket.windowLists.push(w))
    socket.on('window-error', (e) => socket.windowErrors.push(e.message))
    socket.on('state', (s) => socket.states.push(s))
    socket.on('output', (d) => socket.outputs.push(Buffer.from(d)))
    socket.on('exit', (e) => socket.exits.push(e))
    clients.push(socket)
    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(socket))
      socket.on('connect_error', reject)
    })
  }

  it('attaches as user 1000 through a grouped tmux session of its own', async function () {
    const socket = await connect()
    socket.emit('attach', { cols: 100, rows: 30, start: false })
    await waitFor(() => pty.terms.length === 1, 'pty spawned')
    const term = pty.terms[0]
    assert.strictEqual(term.command, 'sudo')
    assert.strictEqual(system.ensures, 1)
    const name = term.args[11]
    assert.match(name, /^web-[0-9a-f]{12}$/)
    assert.deepStrictEqual(term.args, ['-n', '-u', '#1000', '/usr/bin/tmux', '-N', '-S', '/run/rpanion-terminal/tmux.sock', 'new-session', '-t', 'main', '-s', name, ';', 'set-option', 'destroy-unattached', 'on'])
    assert.strictEqual(term.options.cols, 100)
    assert.strictEqual(term.options.rows, 30)
    await waitFor(() => socket.states.some(s => s.state === 'attached'), 'attached state')
    assert.strictEqual(system.starts, 0)
  })

  it('gives every client its own session name', async function () {
    const a = await connect()
    const b = await connect()
    a.emit('attach', { cols: 80, rows: 24, start: false })
    b.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => pty.terms.length === 2, 'ptys spawned')
    assert.notStrictEqual(pty.terms[0].args[11], pty.terms[1].args[11])
  })

  it('does not spawn a client when the main session cannot be created', async function () {
    system.ensureMainSession = async () => { throw new Error('no server') }
    const socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => socket.states.length === 1, 'state')
    assert.strictEqual(socket.states[0].state, 'unavailable')
    assert.match(socket.states[0].message, /no server/)
    assert.strictEqual(pty.terms.length, 0)
  })

  it('does not start a stopped session unless asked to', async function () {
    system.activeState = 'inactive'
    const socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => socket.states.length === 1, 'state')
    assert.deepStrictEqual(socket.states, [{ state: 'inactive' }])
    assert.strictEqual(system.starts, 0)
    assert.strictEqual(pty.terms.length, 0)

    socket.emit('attach', { cols: 80, rows: 24, start: true })
    await waitFor(() => pty.terms.length === 1, 'pty after explicit start')
    assert.strictEqual(system.starts, 1)
  })

  it('ignores start: true unless it is the boolean true', async function () {
    system.activeState = 'inactive'
    const socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: 'true' })
    await waitFor(() => socket.states.length === 1, 'state')
    assert.strictEqual(system.starts, 0)
  })

  it('reports a session that is stopping and a missing unit', async function () {
    system.activeState = 'deactivating'
    let socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: true })
    await waitFor(() => socket.states.length === 1, 'stopping state')
    assert.strictEqual(socket.states[0].state, 'stopping')
    assert.strictEqual(system.starts, 0)

    system.installed = false
    socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: true })
    await waitFor(() => socket.states.length === 1, 'unavailable state')
    assert.strictEqual(socket.states[0].state, 'unavailable')
    assert.match(socket.states[0].message, /not installed/)
  })

  it('disables only the terminal when node-pty cannot be loaded', async function () {
    terminal.closeAll()
    io.close()
    httpServer = http.createServer()
    io = new Server(httpServer, { cookie: false })
    terminal = createTerminal({ io, system, isAuthEnabled: () => true, loadPty: () => { throw new Error('no pty.node') } })
    await new Promise(resolve => httpServer.listen(0, resolve))
    port = httpServer.address().port
    const socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: true })
    await waitFor(() => socket.states.length === 1, 'unavailable state')
    assert.match(socket.states[0].message, /no pty\.node/)
  })

  it('refuses connections when authentication is disabled', async function () {
    authEnabled = false
    await assert.rejects(connect(), /requires authentication/)
  })

  it('limits the number of clients', async function () {
    for (let i = 0; i < MAX_CLIENTS; i++) await connect()
    await assert.rejects(connect(), /At most/)
  })

  it('relays input and validated resize', async function () {
    const socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => pty.terms.length === 1, 'pty spawned')
    const term = pty.terms[0]
    socket.emit('input', 'ls\r')
    socket.emit('input', 42)
    socket.emit('input', 'x'.repeat(256 * 1024 + 1))
    socket.emit('resize', { cols: 120, rows: 40 })
    socket.emit('resize', { cols: 0, rows: 40 })
    socket.emit('resize', { cols: 120, rows: 'a' })
    socket.emit('resize', { cols: 100000, rows: 40 })
    socket.emit('resize', null)
    await waitFor(() => term.resizes.length >= 1, 'resize')
    await wait(100)
    assert.deepStrictEqual(term.written, ['ls\r'])
    assert.deepStrictEqual(term.resizes, [[120, 40]])
  })

  it('rejects an invalid size on attach', async function () {
    const socket = await connect()
    socket.emit('attach', { cols: -1, rows: 24, start: false })
    await waitFor(() => socket.states.length === 1, 'state')
    assert.strictEqual(socket.states[0].state, 'unavailable')
    assert.strictEqual(pty.terms.length, 0)
  })

  it('batches output into binary frames', async function () {
    const socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => pty.terms.length === 1, 'pty spawned')
    const term = pty.terms[0]
    term.emitData(Buffer.from('he'))
    term.emitData(Buffer.from('llo '))
    term.emitData('wörld')
    await waitFor(() => socket.outputs.length > 0, 'output')
    await wait(100)
    assert.strictEqual(socket.outputs.length, 1)
    assert.strictEqual(socket.outputs[0].toString('utf8'), 'hello wörld')
  })

  it('pauses the pty above the unacknowledged limit and resumes after acks', async function () {
    const socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => pty.terms.length === 1, 'pty spawned')
    const term = pty.terms[0]
    const chunk = Buffer.alloc(HIGH_WATER + 1, 'a')
    term.emitData(chunk)
    await waitFor(() => term.pauses === 1, 'pause')
    term.emitData(Buffer.from('more'))
    await waitFor(() => socket.outputs.length === 2, 'second frame')
    assert.strictEqual(term.pauses, 1)

    socket.emit('ack', 10)
    await wait(50)
    assert.strictEqual(term.resumes, 0)
    socket.emit('ack', HIGH_WATER + 1 + 4 - 10 - LOW_WATER)
    await waitFor(() => term.resumes === 1, 'resume')
    socket.emit('ack', 'x')
    socket.emit('ack', -5)
  })

  it('sends SIGHUP to the tmux client on disconnect', async function () {
    const socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => pty.terms.length === 1, 'pty spawned')
    socket.close()
    await waitFor(() => pty.terms[0].kills.length === 1, 'kill')
    assert.deepStrictEqual(pty.terms[0].kills, ['SIGHUP'])
  })

  it('does not spawn a second pty for one socket', async function () {
    const socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => pty.terms.length === 1, 'pty spawned')
    await wait(100)
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    await wait(100)
    assert.strictEqual(pty.terms.length, 1)
  })

  it('flushes pending output and reports the exit of the tmux client', async function () {
    const socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => pty.terms.length === 1, 'pty spawned')
    pty.terms[0].emitData(Buffer.from('bye'))
    pty.terms[0].emitExit(0)
    await waitFor(() => socket.exits.length === 1, 'exit')
    assert.deepStrictEqual(socket.exits, [{ code: 0 }])
    assert.strictEqual(Buffer.concat(socket.outputs).toString(), 'bye')

    // A new attach after the exit starts a fresh client
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => pty.terms.length === 2, 'second pty')
  })

  it('disconnects a client when its token expires', async function () {
    user = { username: 'u', exp: Math.floor(Date.now() / 1000) + 1 }
    const socket = await connect()
    socket.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => pty.terms.length === 1, 'pty spawned')
    await waitFor(() => !socket.connected, 'disconnect after expiry', 3000)
    assert.ok(socket.states.some(s => s.message === 'Login expired'))
    await waitFor(() => pty.terms[0].kills.length === 1, 'kill')
  })

  it('closeAll() disconnects clients and detaches their ptys', async function () {
    const a = await connect()
    const b = await connect()
    a.emit('attach', { cols: 80, rows: 24, start: false })
    b.emit('attach', { cols: 80, rows: 24, start: false })
    await waitFor(() => pty.terms.length === 2, 'ptys spawned')
    terminal.closeAll()
    await waitFor(() => !a.connected && !b.connected, 'disconnected')
    await waitFor(() => pty.terms.every(t => t.kills.length === 1), 'killed')
  })

  describe('tabs', function () {
    async function attached () {
      const socket = await connect()
      socket.emit('attach', { cols: 80, rows: 24, start: false })
      await waitFor(() => socket.windowLists.length >= 1, 'first window list')
      return socket
    }
    const sessionOf = () => pty.terms[pty.terms.length - 1].args[11]

    it('sends the window list of the client session and again only on change', async function () {
      this.timeout(8000)
      const socket = await attached()
      assert.deepStrictEqual(socket.windowLists[0], [{ id: '@0', index: 0, name: 'bash', active: true }])
      assert.ok(system.calls.every(c => c[0] === 'list' && c[1] === sessionOf()))
      await wait(2300)
      assert.strictEqual(socket.windowLists.length, 1)
      system.windows.push({ id: '@3', index: 1, name: 'htop', active: false })
      await waitFor(() => socket.windowLists.length === 2, 'changed list', 3000)
      assert.strictEqual(socket.windowLists[1][1].name, 'htop')
    })

    it('does not list windows before the client is attached', async function () {
      system.activeState = 'inactive'
      const socket = await connect()
      socket.emit('attach', { cols: 80, rows: 24, start: false })
      await wait(300)
      assert.strictEqual(socket.windowLists.length, 0)
      assert.strictEqual(system.calls.length, 0)
    })

    it('opens a window in the client session', async function () {
      const socket = await attached()
      socket.emit('window-new')
      await waitFor(() => socket.windowLists.length === 2, 'list after new')
      assert.deepStrictEqual(system.calls.filter(c => c[0] === 'new'), [['new', sessionOf()]])
      assert.strictEqual(socket.windowLists[1].length, 2)
    })

    it('refuses more than the maximum number of windows', async function () {
      const socket = await attached()
      for (let i = 0; i < MAX_WINDOWS + 2; i++) socket.emit('window-new')
      await waitFor(() => socket.windowErrors.length === 3, 'refusals')
      assert.strictEqual(system.windows.length, MAX_WINDOWS)
      assert.match(socket.windowErrors[0], /At most 8 tabs/)
      assert.strictEqual(system.calls.filter(c => c[0] === 'new').length, MAX_WINDOWS - 1)
    })

    it('closes a window but never the last one', async function () {
      system.windows.push({ id: '@1', index: 1, name: 'bash', active: false })
      const socket = await attached()
      socket.emit('window-close', '@1')
      await waitFor(() => system.windows.length === 1, 'window closed')
      socket.emit('window-close', '@0')
      await waitFor(() => socket.windowErrors.length === 1, 'refusal')
      assert.match(socket.windowErrors[0], /last tab/)
      assert.deepStrictEqual(system.calls.filter(c => c[0] === 'kill'), [['kill', '@1']])
    })

    it('selects a window in the client session only', async function () {
      system.windows.push({ id: '@1', index: 1, name: 'bash', active: false })
      const socket = await attached()
      socket.emit('window-select', '@1')
      await waitFor(() => socket.windowLists.length === 2, 'list after select')
      assert.deepStrictEqual(system.calls.filter(c => c[0] === 'select'), [['select', sessionOf(), '@1']])
      assert.deepStrictEqual(socket.windowLists[1].map(w => w.active), [false, true])
    })

    it('renames a window, trims the name and refuses long or control-character names', async function () {
      const socket = await attached()
      socket.emit('window-rename', { id: '@0', name: '  camera  ' })
      await waitFor(() => socket.windowLists.length === 2, 'list after rename')
      assert.strictEqual(socket.windowLists[1][0].name, 'camera')
      socket.emit('window-rename', { id: '@0', name: 'x'.repeat(33) })
      socket.emit('window-rename', { id: '@0', name: 'a\nb' })
      await waitFor(() => socket.windowErrors.length === 2, 'refusals')
      assert.match(socket.windowErrors[0], /up to 32 characters/)
      socket.emit('window-rename', { id: '@0', name: '' })
      await waitFor(() => system.calls.filter(c => c[0] === 'rename').length === 2, 'reset to automatic')
      assert.deepStrictEqual(system.calls.filter(c => c[0] === 'rename'), [['rename', '@0', 'camera'], ['rename', '@0', '']])
    })

    it('ignores malformed rename payloads and unknown windows', async function () {
      const socket = await attached()
      for (const payload of [null, '@0', { id: '@0' }, { id: '@0', name: 5 }, { id: 'x', name: 'a' }, { name: 'a' }]) {
        socket.emit('window-rename', payload)
      }
      socket.emit('window-rename', { id: '@9', name: 'a' })
      await waitFor(() => socket.windowErrors.length === 1, 'unknown window')
      assert.match(socket.windowErrors[0], /no longer exists/)
      assert.deepStrictEqual(system.calls.filter(c => c[0] === 'rename'), [])
    })

    it('ignores malformed ids and windows outside the session', async function () {
      const socket = await attached()
      for (const id of ['1', '@', '@1x', '@1; kill-server', '-t', 5, null, undefined, { id: '@0' }, '@0\n']) {
        socket.emit('window-close', id)
        socket.emit('window-select', id)
      }
      socket.emit('window-close', '@9')
      socket.emit('window-select', '@9')
      await waitFor(() => socket.windowErrors.length === 2, 'errors for unknown windows')
      assert.match(socket.windowErrors[0], /no longer exists/)
      assert.deepStrictEqual(system.calls.filter(c => c[0] !== 'list'), [])
    })

    it('reports a failing tmux call without dropping the connection', async function () {
      const socket = await attached()
      system.newWindow = async () => { throw new Error('sudo: a password is required') }
      socket.emit('window-new')
      await waitFor(() => socket.windowErrors.length === 1, 'error')
      assert.match(socket.windowErrors[0], /password/)
      assert.ok(socket.connected)
    })

    it('ignores window operations before attach', async function () {
      const socket = await connect()
      socket.emit('window-new')
      socket.emit('window-close', '@0')
      socket.emit('window-select', '@0')
      await wait(100)
      assert.deepStrictEqual(system.calls, [])
    })

    it('stops polling after the tmux client exits or the socket closes', async function () {
      this.timeout(8000)
      const socket = await attached()
      pty.terms[0].emitExit(0)
      await waitFor(() => socket.exits.length === 1, 'exit')
      const count = system.calls.length
      await wait(1300)
      assert.strictEqual(system.calls.length, count)

      const other = await attached()
      other.close()
      await waitFor(() => pty.terms[1].kills.length === 1, 'kill')
      await wait(100)
      const after = system.calls.length
      await wait(1300)
      assert.strictEqual(system.calls.length, after)
    })
  })
})
