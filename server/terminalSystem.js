/*
 * System side of the web terminal: state of rpanion-terminal.service, start/stop through sudoers
 * rules, and the cgroup counters of user-1000.slice (the slice shared by the terminal and SSH
 * sessions of user pi; no swap for it, see deploy/rpanion-user-slice.conf).
 */
const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')

const UNIT = 'rpanion-terminal'
const SYSTEMCTL = '/usr/bin/systemctl'
const TMUX = '/usr/bin/tmux'
const SOCKET = '/run/rpanion-terminal/tmux.sock'
// Fixed prefix of every tmux call; matches the sudoers rule. -N: a missing unit must not start a
// tmux server outside it.
const TMUX_SUDO = ['-u', '#1000', TMUX, '-N', '-S', SOCKET]
const MAIN_SESSION = 'main'
const SESSION_NAME = /^web-[0-9a-f]{12}$/
const WINDOW_ID = /^@\d+$/
const SLICE_DIR = '/sys/fs/cgroup/user.slice/user-1000.slice'
const PATHS = {
  controllers: '/sys/fs/cgroup/cgroup.controllers',
  sliceDir: SLICE_DIR
}
// "key value" and "key=value" lines
function parseKeyValues (text, separator) {
  const result = {}
  for (const line of (text || '').split('\n')) {
    const match = separator === '=' ? line.match(/^(\w+)=(.*)$/) : line.match(/^(\w+)\s+(.*)$/)
    if (match) result[match[1]] = match[2].trim()
  }
  return result
}

function checkSession (name) {
  if (!SESSION_NAME.test(name)) throw new Error('Invalid session name')
}

function checkWindow (id) {
  if (!WINDOW_ID.test(id)) throw new Error('Invalid window id')
}

// Window names are set by programs; keep one printable line
function cleanName (name) {
  return name.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 40)
}

function parseWindows (text) {
  const windows = []
  for (const line of (text || '').split('\n')) {
    const [id, index, active, ...name] = line.split('\t')
    if (!WINDOW_ID.test(id) || !/^\d+$/.test(index)) continue
    windows.push({ id, index: Number(index), name: cleanName(name.join('\t')), active: active === '1' })
  }
  return windows.sort((a, b) => a.index - b.index)
}

function createTerminalSystem ({ execFile = childProcess.execFile, readFile = fs.promises.readFile, paths = {} } = {}) {
  const p = { ...PATHS, ...paths }

  const run = (command, args) => new Promise((resolve, reject) => {
    execFile(command, args, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error((stderr || '').trim() || err.message))
      }
      resolve(stdout)
    })
  })

  // -n: fail instead of waiting for a password when the sudoers rule is missing
  const sudo = (args) => run('sudo', ['-n', ...args])

  const tmux = (args) => sudo([...TMUX_SUDO, ...args])

  const read = (file) => readFile(file, 'utf8').catch(() => null)

  async function getActiveState () {
    try {
      const out = parseKeyValues(await run('systemctl', ['show', '-p', 'ActiveState', '-p', 'LoadState', UNIT]), '=')
      return { installed: out.LoadState === 'loaded', activeState: out.ActiveState || 'unknown' }
    } catch (err) {
      return { installed: false, activeState: 'unknown' }
    }
  }

  async function readOomKills () {
    const events = parseKeyValues(await read(`${p.sliceDir}/memory.events`), ' ')
    return events.oom_kill === undefined ? null : Number(events.oom_kill)
  }

  return {
    getActiveState,
    readOomKills,

    async start () {
      await sudo([SYSTEMCTL, 'start', UNIT])
    },

    // --no-block: stopping takes up to ~15 s, the caller polls the state
    async stop () {
      await sudo([SYSTEMCTL, 'stop', '--no-block', UNIT])
    },

    // tmux with -N needs a running server; "main" is gone after the last window exited
    async ensureMainSession () {
      try {
        await tmux(['new-session', '-d', '-s', MAIN_SESSION, '-c', '~'])
      } catch (err) {
        // Another client created it first
        if (!/duplicate session/.test(err.message)) throw err
      }
    },

    // Windows are shared by the sessions of the group "main"; "active" is per session
    async listWindows (session) {
      checkSession(session)
      const format = ['#{window_id}', '#{window_index}', '#{window_active}', '#{window_name}'].join('\t')
      return parseWindows(await tmux(['list-windows', '-t', `${session}:`, '-F', format]))
    },

    async newWindow (session) {
      checkSession(session)
      await tmux(['new-window', '-t', `${session}:`, '-c', '~'])
    },

    async killWindow (id) {
      checkWindow(id)
      await tmux(['kill-window', '-t', id])
    },

    // An empty name hands the window back to tmux automatic naming (name of the running program)
    async renameWindow (id, name) {
      checkWindow(id)
      if (name === '') {
        await tmux(['set-window-option', '-t', id, 'automatic-rename', 'on'])
        return
      }
      // rename-window expands #{...} formats; ## keeps a literal #. tmux ends the command at an
      // argument ending in ';', so a trailing ; is sent as \; (the name then keeps the ;).
      await tmux(['rename-window', '-t', id, '--', name.replace(/#/g, '##').replace(/;$/, '\\;')])
    },

    async selectWindow (session, id) {
      checkSession(session)
      checkWindow(id)
      await tmux(['select-window', '-t', `${session}:${id}`])
    },

    // Panes of all sessions with their tmux server pid and whether a pipe-pane is attached
    async listPanes () {
      const out = await tmux(['list-panes', '-a', '-F', '#{pid} #{pane_id} #{pane_pipe}'])
      const panes = []
      for (const line of out.split('\n')) {
        const m = line.match(/^(\d+) %(\d+) ([01])$/)
        if (m) panes.push({ pid: m[1], pane: m[2], piped: m[3] === '1' })
      }
      return panes
    },

    async getStats () {
      const controllers = await read(p.controllers)
      const stat = parseKeyValues(await read(`${p.sliceDir}/memory.stat`), ' ')
      const cpu = parseKeyValues(await read(`${p.sliceDir}/cpu.stat`), ' ')
      const hasMemory = stat.anon !== undefined
      return {
        memory: {
          controller: /\bmemory\b/.test(controllers || '') && hasMemory,
          anonBytes: hasMemory ? Number(stat.anon) : null,
          totalBytes: os.totalmem(),
          oomKills: await readOomKills()
        },
        cpu: { usageUsec: cpu.usage_usec === undefined ? null : Number(cpu.usage_usec), cores: os.cpus().length },
        sampledAt: Date.now()
      }
    }
  }
}

module.exports = { createTerminalSystem, TMUX_SUDO, MAIN_SESSION, WINDOW_ID }
