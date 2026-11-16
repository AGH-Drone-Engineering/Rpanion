/*
 * iproute2 wrapper. sudo is limited by sudoers to `ip addr add|del * dev *`.
 */
const { execFile } = require('child_process')
const util = require('util')

const execFileAsync = util.promisify(execFile)

async function run (args, { sudo = false } = {}) {
  const [cmd, cmdArgs] = sudo ? ['sudo', ['ip', ...args]] : ['ip', args]
  try {
    const { stdout } = await execFileAsync(cmd, cmdArgs)
    return stdout
  } catch (err) {
    const error = new Error((err.stderr || '').trim() || err.message)
    error.stderr = err.stderr || ''
    throw error
  }
}

module.exports = { run }
