/*
 * Device name (hostname, mDNS name and WiFiAP SSID) and SSH password.
 * Changes go through the root helper /usr/local/sbin/rpanion-system, the
 * only command allowed through sudoers for this. Validation rules match
 * the helper's valid_device_name().
 */
const childProcess = require('child_process')
const os = require('os')

const HELPER = '/usr/local/sbin/rpanion-system'
const SSH_USER = 'pi'
// The device name is also the AP SSID, which is limited to 32 bytes
const DEVICE_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/
const DEVICE_NAME_RULES = 'Device name must be 1-32 characters: lowercase letters, digits and hyphens, ' +
  'not starting or ending with a hyphen, not only digits, not "localhost"'
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 64

// All-digit names are read as IPv4 numbers by inet_aton()
function isValidDeviceName (name) {
  return typeof name === 'string' && DEVICE_NAME_RE.test(name) && name !== 'localhost' && !/^[0-9]+$/.test(name)
}

function invalid (message) {
  const error = new Error(message)
  error.status = 422
  return error
}

function createSystemIdentity ({ execFile = childProcess.execFile, getHostname = os.hostname } = {}) {
  // input is written to the helper's stdin so passwords stay out of argv
  const runHelper = (args, input) => new Promise((resolve, reject) => {
    // -n: fail instead of waiting for a password when the sudoers rule is missing
    const child = execFile('sudo', ['-n', HELPER, ...args], (err, stdout, stderr) => {
      if (err) {
        return reject(new Error((stderr || '').trim() || err.message))
      }
      resolve(stdout)
    })
    if (input !== undefined) {
      child.stdin.end(input + '\n')
    }
  })

  return {
    getIdentity () {
      return { hostname: getHostname(), sshUser: SSH_USER }
    },

    async setHostname (name) {
      if (!isValidDeviceName(name)) {
        throw invalid(DEVICE_NAME_RULES)
      }
      await runHelper(['hostname', name])
    },

    async setSshPassword (password) {
      if (typeof password !== 'string' ||
          password.length < MIN_PASSWORD_LENGTH ||
          password.length > MAX_PASSWORD_LENGTH ||
          /[\x00-\x1f\x7f]/.test(password)) {
        throw invalid(`SSH password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters without control characters`)
      }
      await runHelper(['sshpassword'], password)
    }
  }
}

module.exports = { createSystemIdentity, isValidDeviceName, DEVICE_NAME_RULES, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH }
