const assert = require('assert')
const http = require('http')
const { Server } = require('socket.io')
const { io: ioClient } = require('socket.io-client')
const { createTerminal, MAX_CLIENTS, HIGH_WATER, LOW_WATER } = require('./terminal')

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
      getActiveState: async () => ({ installed: system.installed, activeState: system.activeState }),
      start: async () => { system.starts++; system.activeState = 'active' }
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
    socket.on('state', (s) => socket.states.push(s))
    socket.on('output', (d) => socket.outputs.push(Buffer.from(d)))
    socket.on('exit', (e) => socket.exits.push(e))
    clients.push(socket)
    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(socket))
      socket.on('connect_error', reject)
    })
  }

  it('attaches to the running session as user 1000 through tmux', async function () {
    const socket = await connect()
    socket.emit('attach', { cols: 100, rows: 30, start: false })
    await waitFor(() => pty.terms.length === 1, 'pty spawned')
    const term = pty.terms[0]
    assert.strictEqual(term.command, 'sudo')
    assert.deepStrictEqual(term.args, ['-n', '-u', '#1000', '/usr/bin/tmux', '-N', '-S', '/run/rpanion-terminal/tmux.sock', 'new-session', '-A', '-s', 'main'])
    assert.strictEqual(term.options.cols, 100)
    assert.strictEqual(term.options.rows, 30)
    await waitFor(() => socket.states.some(s => s.state === 'attached'), 'attached state')
    assert.strictEqual(system.starts, 0)
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
})
