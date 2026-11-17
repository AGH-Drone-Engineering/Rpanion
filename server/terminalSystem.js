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

    async getStats () {
      const controllers = await read(p.controllers)
      const stat = parseKeyValues(await read(`${p.sliceDir}/memory.stat`), ' ')
      const max = (await read(`${p.sliceDir}/memory.max`) || '').trim()
      const cpu = parseKeyValues(await read(`${p.sliceDir}/cpu.stat`), ' ')
      const hasMemory = stat.anon !== undefined
      return {
        memory: {
          controller: /\bmemory\b/.test(controllers || '') && hasMemory,
          anonBytes: hasMemory ? Number(stat.anon) : null,
          maxBytes: /^\d+$/.test(max) ? Number(max) : null,
          totalBytes: os.totalmem(),
          oomKills: await readOomKills()
        },
        cpu: { usageUsec: cpu.usage_usec === undefined ? null : Number(cpu.usage_usec), cores: os.cpus().length },
        sampledAt: Date.now()
      }
    }
  }
}

module.exports = { createTerminalSystem, UNIT }
