/*
 * nmcli process wrapper and output parsers.
 * Failure is decided by exit code only; nmcli writes warnings to stderr on
 * successful calls. LC_ALL=C keeps error texts matchable.
 */
const { execFile } = require('child_process')
const util = require('util')

const execFileAsync = util.promisify(execFile)

/**
 * @param {string[]} args nmcli arguments
 * @param {{sudo?: boolean}} options sudo is needed for changes and for reading secrets
 * @returns {Promise<string>} stdout
 */
async function run (args, { sudo = false } = {}) {
  const [cmd, cmdArgs] = sudo ? ['sudo', ['nmcli', ...args]] : ['nmcli', args]
  try {
    const { stdout } = await execFileAsync(cmd, cmdArgs, { env: { ...process.env, LC_ALL: 'C' } })
    return stdout
  } catch (err) {
    const error = new Error(((err.stderr || '').trim() || err.message).replace(/^Error: /, ''))
    error.stdout = err.stdout || ''
    throw error
  }
}

// Terse (-t) rows escape ':' and '\' inside values with a backslash
function parseTerseRow (line) {
  const fields = []
  let current = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && i + 1 < line.length) {
      current += line[++i]
    } else if (ch === ':') {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

// Multiline key:value output (-s -t -f a,b connection show X Y ...); values are
// not escaped in this mode, so only the first ':' separates key and value.
function parseMultiline (stdout, startKey) {
  const records = []
  let current = null
  for (const line of stdout.split('\n')) {
    const sep = line.indexOf(':')
    if (sep < 0) continue
    const key = line.slice(0, sep)
    const value = line.slice(sep + 1)
    if (key === startKey) {
      current = {}
      records.push(current)
    }
    if (current) current[key] = value
  }
  return records
}

module.exports = { run, parseTerseRow, parseMultiline }
