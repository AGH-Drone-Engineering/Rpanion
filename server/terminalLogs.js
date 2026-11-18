/*
 * Terminal session logs written by deploy/rpanion-terminal-log-pane.py (one file per tmux pane).
 * The on/off setting is the presence of the .disabled file in the log directory.
 */
const fs = require('fs')
const path = require('path')
const { Transform, pipeline } = require('stream')
const logpaths = require('./paths.js')

const FILE_NAME = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(\d+)_p(\d+)(?:-(\d+))?\.log$/
const DISABLED_FLAG = '.disabled'
const NO_SERVER = /no server running|error connecting/i

// Removes escape sequences; a bare \r overwrites the start of the line, \r\n is kept
function stripAnsi (text) {
  const cleaned = text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(/\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()*+][0-9A-Za-z]/g, '')
    .replace(/\x1b[@-Z\\-_=>78]/g, '')
    .replace(/[\x00-\x07\x0b\x0c\x0e-\x1f\x7f]/g, '')
  return cleaned.split(/(\r?\n)/).map((part, i) => (i % 2 === 1 ? part : overwriteLine(part))).join('')
}

function overwriteLine (line) {
  const out = []
  for (const segment of line.split('\r')) {
    const chars = Array.from(segment)
    let col = 0
    for (const ch of chars) {
      if (ch === '\x08') {
        col = Math.max(0, col - 1)
      } else {
        out[col++] = ch
      }
    }
  }
  return out.join('')
}

function lineStripper () {
  let rest = ''
  return new Transform({
    decodeStrings: false,
    transform (chunk, enc, cb) {
      const lines = (rest + chunk).split('\n')
      rest = lines.pop()
      for (const line of lines) this.push(stripAnsi(line + '\n'))
      cb()
    },
    flush (cb) {
      if (rest) this.push(stripAnsi(rest))
      cb()
    }
  })
}

function createTerminalLogs ({ dir = logpaths.terminalLogDir, listPanes = async () => [] } = {}) {
  const flagPath = path.join(dir, DISABLED_FLAG)

  const entries = () => {
    let names
    try {
      names = fs.readdirSync(dir)
    } catch (e) {
      if (e.code === 'ENOENT') return []
      throw e
    }
    const files = []
    for (const name of names) {
      const m = FILE_NAME.exec(name)
      if (!m) continue
      let stat
      try {
        stat = fs.statSync(path.join(dir, name))
      } catch (e) {
        if (e.code === 'ENOENT') continue
        throw e
      }
      files.push({ name, pid: m[1], pane: m[2], seq: Number(m[3] || 1), stat })
    }
    return files
  }

  // A file is in use when its pane still has a pipe and it is the newest file of that pane
  async function activeNames (files) {
    let panes = []
    try {
      panes = await listPanes()
    } catch (e) {
      if (!NO_SERVER.test(e.message || '')) throw e
    }
    const piped = new Set(panes.filter(p => p.piped).map(p => `${p.pid}_${p.pane}`))
    const newest = new Map()
    for (const f of files) {
      const key = `${f.pid}_${f.pane}`
      if (!newest.has(key) || newest.get(key).seq < f.seq) newest.set(key, f)
    }
    const active = new Set()
    for (const [key, f] of newest) {
      if (piped.has(key)) active.add(f.name)
    }
    return active
  }

  return {
    isValidName: (name) => typeof name === 'string' && FILE_NAME.test(name),

    isEnabled: () => !fs.existsSync(flagPath),

    setEnabled (enabled) {
      fs.mkdirSync(dir, { recursive: true })
      if (enabled) {
        fs.rmSync(flagPath, { force: true })
      } else {
        fs.closeSync(fs.openSync(flagPath, 'a'))
      }
    },

    async list () {
      const files = entries()
      let active
      try {
        active = await activeNames(files)
      } catch (e) {
        console.error(`Cannot query tmux panes: ${e.message || e}`)
        active = new Set(files.map(f => f.name))
      }
      return files
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
        .map(f => ({
          name: f.name,
          size: Math.round(f.stat.size / 1024),
          modified: new Date(f.stat.mtimeMs).toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
          mtime: Math.round(f.stat.mtimeMs),
          active: active.has(f.name)
        }))
    },

    async clear () {
      const files = entries()
      const active = await activeNames(files)
      const result = { deleted: 0, skipped: 0 }
      for (const f of files) {
        if (active.has(f.name)) {
          result.skipped++
        } else {
          fs.unlinkSync(path.join(dir, f.name))
          result.deleted++
        }
      }
      console.log(`Cleared terminal: deleted ${result.deleted}, kept ${result.skipped}`)
      return result
    },

    // Stream of one log without escape sequences
    read (name) {
      if (!FILE_NAME.test(name)) {
        const err = new Error('Invalid log name')
        err.status = 400
        throw err
      }
      const file = path.join(dir, name)
      try {
        fs.accessSync(file, fs.constants.R_OK)
      } catch (e) {
        if (e.code === 'ENOENT') {
          const err = new Error('Log not found')
          err.status = 404
          throw err
        }
        throw e
      }
      const out = lineStripper()
      pipeline(fs.createReadStream(file, { encoding: 'utf8' }), out, () => {})
      return out
    }
  }
}

module.exports = { createTerminalLogs, stripAnsi }
