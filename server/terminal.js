/*
 * Web terminal relay on the socket.io namespace /terminal. Each client gets its own pty running a
 * tmux client attached to the session "main" of rpanion-terminal.service (tmux server as user 1000),
 * so the session outlives the browser and this process.
 *
 * Client to server: attach {cols, rows, start}, input (string), resize {cols, rows}, ack (bytes).
 * Server to client: state {state, message?}, output (binary), exit {code}.
 * Input is never logged.
 */
const SOCKET = '/run/rpanion-terminal/tmux.sock'
const ATTACH_COMMAND = ['sudo', ['-n', '-u', '#1000', '/usr/bin/tmux', '-N', '-S', SOCKET, 'new-session', '-A', '-s', 'main']]

const MAX_CLIENTS = 4
const FLUSH_INTERVAL_MS = 30
// Unacknowledged output above HIGH_WATER pauses the pty until the client has consumed down to LOW_WATER
const HIGH_WATER = 256 * 1024
const LOW_WATER = 64 * 1024
const MAX_INPUT_BYTES = 256 * 1024
const MAX_COLS = 500
const MAX_ROWS = 200
const MAX_TIMER_MS = 2 ** 31 - 1

function validSize (cols, rows) {
  return Number.isInteger(cols) && Number.isInteger(rows) && cols >= 1 && cols <= MAX_COLS && rows >= 1 && rows <= MAX_ROWS
}

function createTerminal ({ io, system, isAuthEnabled, loadPty = () => require('node-pty') }) {
  const nsp = io.of('/terminal')
  const sessions = new Set()
  let pty = null
  let ptyError = null

  // Lazy load: a missing native build disables only the terminal
  function getPty () {
    if (pty === null && ptyError === null) {
      try {
        pty = loadPty()
      } catch (err) {
        ptyError = `Terminal is not available: ${err.message}`
        console.error(ptyError)
      }
    }
    return pty
  }

  nsp.use((socket, next) => {
    if (!isAuthEnabled()) {
      return next(new Error('Terminal requires authentication to be enabled'))
    }
    if (nsp.sockets.size >= MAX_CLIENTS) {
      return next(new Error(`At most ${MAX_CLIENTS} terminal clients at once`))
    }
    next()
  })

  nsp.on('connection', (socket) => {
    const session = { socket, term: null, chunks: [], flushTimer: null, unacked: 0, paused: false, expiryTimer: null, closing: false }
    sessions.add(session)

    // JWTs expire after 1 h; an open socket must not outlive its token
    const exp = socket.request && socket.request.user && socket.request.user.exp
    if (exp) {
      const ms = Math.max(0, exp * 1000 - Date.now())
      session.expiryTimer = setTimeout(() => {
        socket.emit('state', { state: 'unavailable', message: 'Login expired' })
        socket.disconnect(true)
      }, Math.min(ms, MAX_TIMER_MS))
    }

    const flush = () => {
      session.flushTimer = null
      if (session.chunks.length === 0) return
      const data = Buffer.concat(session.chunks)
      session.chunks = []
      session.unacked += data.length
      socket.emit('output', data)
      if (session.unacked > HIGH_WATER && !session.paused && session.term) {
        session.paused = true
        session.term.pause()
      }
    }

    const release = () => {
      clearTimeout(session.flushTimer)
      clearTimeout(session.expiryTimer)
      session.flushTimer = null
      session.chunks = []
      sessions.delete(session)
    }

    const kill = () => {
      const term = session.term
      session.term = null
      if (term) {
        try {
          // The tmux client detaches on SIGHUP; the session keeps running
          term.kill('SIGHUP')
        } catch (err) {
          // already gone
        }
      }
    }

    async function attach (payload) {
      const { cols = 80, rows = 24, start = false } = payload || {}
      if (session.term || session.attaching) return
      if (!validSize(cols, rows)) {
        return socket.emit('state', { state: 'unavailable', message: 'Invalid terminal size' })
      }
      const ptyModule = getPty()
      if (!ptyModule) {
        return socket.emit('state', { state: 'unavailable', message: ptyError })
      }
      session.attaching = true
      try {
        const { installed, activeState } = await system.getActiveState()
        if (!installed) {
          return socket.emit('state', { state: 'unavailable', message: 'rpanion-terminal.service is not installed' })
        }
        if (activeState === 'deactivating') {
          return socket.emit('state', { state: 'stopping' })
        }
        if (activeState !== 'active') {
          if (start !== true) {
            return socket.emit('state', { state: 'inactive' })
          }
          await system.start()
        }
        if (session.closing) return

        const [command, args] = ATTACH_COMMAND
        const term = ptyModule.spawn(command, args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: '/',
          encoding: null,
          // sudo keeps TERM and LANG; the tmux client needs a UTF-8 locale to pass non-ASCII text
          env: { PATH: process.env.PATH, TERM: 'xterm-256color', LANG: 'C.UTF-8' }
        })
        session.term = term
        term.onData((data) => {
          session.chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
          if (!session.flushTimer) {
            session.flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS)
          }
        })
        term.onExit(({ exitCode }) => {
          if (session.term !== term) return
          clearTimeout(session.flushTimer)
          flush()
          session.term = null
          session.unacked = 0
          session.paused = false
          socket.emit('exit', { code: exitCode })
        })
        socket.emit('state', { state: 'attached' })
      } catch (err) {
        console.error(`Terminal attach failed: ${err.message || err}`)
        socket.emit('state', { state: 'unavailable', message: err.message || String(err) })
      } finally {
        session.attaching = false
      }
    }

    socket.on('attach', attach)

    socket.on('input', (data) => {
      if (!session.term || typeof data !== 'string' || data.length === 0) return
      if (Buffer.byteLength(data) > MAX_INPUT_BYTES) return
      session.term.write(data)
    })

    socket.on('resize', (size) => {
      if (!session.term || !size || !validSize(size.cols, size.rows)) return
      session.term.resize(size.cols, size.rows)
    })

    socket.on('ack', (bytes) => {
      if (!Number.isInteger(bytes) || bytes <= 0) return
      session.unacked = Math.max(0, session.unacked - bytes)
      if (session.paused && session.unacked <= LOW_WATER && session.term) {
        session.paused = false
        session.term.resume()
      }
    })

    socket.on('disconnect', () => {
      session.closing = true
      release()
      kill()
    })
  })

  return {
    closeAll () {
      for (const session of [...sessions]) {
        session.closing = true
        session.socket.disconnect(true)
      }
      nsp.disconnectSockets(true)
    }
  }
}

module.exports = { createTerminal, MAX_CLIENTS, HIGH_WATER, LOW_WATER }
