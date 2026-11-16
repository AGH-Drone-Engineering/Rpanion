/*
 * Files shared with deploy/rpanion-wifi-watchdog.sh (runs as root).
 * State dir is /run/rpanion-wifi (0770 root:rpanion); the config file is
 * parsed by the watchdog, never sourced.
 * Paths can be overridden through environment variables for tests.
 */
const fs = require('fs')
const path = require('path')

function stateDir () {
  return process.env.RPANION_WIFI_STATE_DIR || '/run/rpanion-wifi'
}

function configFile () {
  return process.env.RPANION_WIFI_CONFIG || '/etc/default/rpanion-wifi'
}

function removeIfPresent (file) {
  try {
    fs.unlinkSync(file)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Cannot remove ${file}: ${err.message}`)
    }
  }
}

// Clears the disconnect timer and manual hold so the watchdog re-evaluates
// from scratch after the user changes Wi-Fi profiles.
function reset () {
  removeIfPresent(path.join(stateDir(), 'disconnect-time'))
  removeIfPresent(path.join(stateDir(), 'manual-hold'))
}

// While held, the watchdog keeps the AP up and does not switch to client networks.
function setManualHold (enabled) {
  const file = path.join(stateDir(), 'manual-hold')
  if (!enabled) {
    removeIfPresent(file)
    return
  }
  try {
    fs.writeFileSync(file, '')
  } catch (err) {
    console.error(`Cannot write ${file}: ${err.message}`)
  }
}

function readConfig () {
  try {
    const match = fs.readFileSync(configFile(), 'utf8').match(/^AP_AUTO_RECONNECT=(true|false)$/m)
    if (match) {
      return { apAutoReconnect: match[1] === 'true' }
    }
  } catch (_) {}
  return { apAutoReconnect: true }
}

async function writeConfig ({ apAutoReconnect }) {
  await fs.promises.writeFile(configFile(), `AP_AUTO_RECONNECT=${apAutoReconnect === true}\n`)
}

module.exports = { reset, setManualHold, readConfig, writeConfig }
