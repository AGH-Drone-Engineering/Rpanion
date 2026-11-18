/*
 * Web terminal relay on the socket.io namespace /terminal. Each client gets its own pty running a
 * tmux client in rpanion-terminal.service (tmux server as user 1000), so the programs outlive the
 * browser and this process. Tabs are the windows of the session "main", shared with SSH and other
 * browsers. Every client attaches to its own session of the group "main" (web-<random>), which has
 * the same windows but its own active one; tmux removes it when the client detaches
 * (destroy-unattached).
 *
 * Client to server: attach {cols, rows, start}, input (string), resize {cols, rows}, ack (bytes),
 *   window-new, window-close (id), window-select (id), window-rename {id, name}.
 * Server to client: state {state, message?}, output (binary), exit {code},
 *   windows [{id, index, name, active}] (on change), window-error {message}.
 * Input is never logged.
 */
const crypto = require('crypto')
const { TMUX_SUDO, MAIN_SESSION, WINDOW_ID } = require('./terminalSystem')

function attachCommand (sessionName) {
  return ['sudo', ['-n', ...TMUX_SUDO, 'new-session', '-t', MAIN_SESSION, '-s', sessionName, ';', 'set-option', 'destroy-unattached', 'on']]
}

const MAX_CLIENTS = 10
const MAX_WINDOWS = 8
const MAX_TAB_NAME = 32
// tmux has no change notifications for a client that is not attached through it
const WINDOWS_POLL_MS = 3000
// First listing after the spawn: the tmux client needs a moment to create its session
const WINDOWS_FIRST_POLL_MS = 150
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
  let knownWindowIds = null

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
    // The JWT of the handshake (see authenticateToken in index.js); logout closes the sockets of one token
    const authorization = socket.handshake && socket.handshake.headers && socket.handshake.headers.authorization
    const session = {
      socket,
      token: typeof authorization === 'string' ? authorization.split(' ')[1] || null : null,
      username: socket.request && socket.request.user ? socket.request.user.username : null,
      name: null,
      term: null,
      chunks: [],
      flushTimer: null,
      unacked: 0,
      paused: false,
      expiryTimer: null,
      closing: false,
      windowsKey: null,
      pollTimer: null,
      refreshing: false,
      queue: Promise.resolve()
    }
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

    const stopPolling = () => {
      clearTimeout(session.pollTimer)
      session.pollTimer = null
      session.windowsKey = null
    }

    async function refreshWindows () {
      if (!session.term || session.refreshing) return
      session.refreshing = true
      try {
        const windows = await system.listWindows(session.name)
        const key = JSON.stringify(windows)
        const idsKey = windows.map(w => w.id).join(',')
        if (session.term && idsKey !== knownWindowIds) {
          knownWindowIds = idsKey
          io.sockets.emit('logs:changed', { type: 'terminal' })
        }
        if (session.term && key !== session.windowsKey) {
          session.windowsKey = key
          socket.emit('windows', windows)
        }
      } catch (err) {
        // The next poll retries; the end of the session is reported by the pty exit
      } finally {
        session.refreshing = false
      }
    }

    const schedulePoll = (delay) => {
      session.pollTimer = setTimeout(async () => {
        await refreshWindows()
        if (session.term) schedulePoll(WINDOWS_POLL_MS)
      }, delay)
    }

    // Window operations of one client run in order so that the limit checks see each other's result
    const windowOperation = (operation) => {
      session.queue = session.queue.then(async () => {
        if (!session.term) return
        try {
          await operation()
        } catch (err) {
          if (!err.expected) console.error(`Terminal window operation failed: ${err.message || err}`)
          socket.emit('window-error', { message: err.message || String(err) })
        }
        await refreshWindows()
      })
    }

    const expectedError = (message) => Object.assign(new Error(message), { expected: true })

    async function requireWindow (id) {
      const windows = await system.listWindows(session.name)
      if (!windows.some(w => w.id === id)) throw expectedError('The tab no longer exists')
      return windows
    }

    const release = () => {
      clearTimeout(session.flushTimer)
      clearTimeout(session.expiryTimer)
      stopPolling()
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
        await system.ensureMainSession()
        if (session.closing) return

        session.name = `web-${crypto.randomBytes(6).toString('hex')}`
        const [command, args] = attachCommand(session.name)
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
          stopPolling()
          session.unacked = 0
          session.paused = false
          socket.emit('exit', { code: exitCode })
        })
        socket.emit('state', { state: 'attached' })
        schedulePoll(WINDOWS_FIRST_POLL_MS)
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

    socket.on('window-new', () => windowOperation(async () => {
      const windows = await system.listWindows(session.name)
      if (windows.length >= MAX_WINDOWS) throw expectedError(`At most ${MAX_WINDOWS} tabs`)
      await system.newWindow(session.name)
    }))

    socket.on('window-close', (id) => {
      if (typeof id !== 'string' || !WINDOW_ID.test(id)) return
      windowOperation(async () => {
        const windows = await requireWindow(id)
        // Closing the last window would end the session and every client with it
        if (windows.length <= 1) throw expectedError('The last tab cannot be closed')
        await system.killWindow(id)
      })
    })

    // Empty name: back to automatic naming
    socket.on('window-rename', (payload) => {
      const id = payload?.id
      const name = typeof payload?.name === 'string' ? payload.name.trim() : null
      if (typeof id !== 'string' || !WINDOW_ID.test(id) || name === null) return
      windowOperation(async () => {
        if (name.length > MAX_TAB_NAME || /[\x00-\x1f\x7f]/.test(name)) {
          throw expectedError(`Tab names are up to ${MAX_TAB_NAME} characters`)
        }
        await requireWindow(id)
        await system.renameWindow(id, name)
      })
    })

    socket.on('window-select', (id) => {
      if (typeof id !== 'string' || !WINDOW_ID.test(id)) return
      windowOperation(async () => {
        await requireWindow(id)
        await system.selectWindow(session.name, id)
      })
    })

    socket.on('disconnect', () => {
      session.closing = true
      release()
      kill()
    })
  })

  function closeWhere (predicate) {
    for (const session of [...sessions]) {
      if (!predicate(session)) continue
      session.closing = true
      session.socket.disconnect(true)
    }
  }

  return {
    // Several browsers can be logged in as the same user; each has its own token
    closeToken (token) {
      if (!token) return
      closeWhere(session => session.token === token)
    },
    closeUser (username) {
      if (!username) return
      closeWhere(session => session.username === username)
    },
    closeAll () {
      closeWhere(() => true)
      nsp.disconnectSockets(true)
    }
  }
}

module.exports = { createTerminal, MAX_CLIENTS, MAX_WINDOWS, HIGH_WATER, LOW_WATER, WINDOWS_POLL_MS }
