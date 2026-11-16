const { exec, execFile } = require('child_process')
const util = require('util')
const fs = require('fs')
const settings = require('settings-store')

const execFileAsync = util.promisify(execFile)

async function getAdapters (callback) {
  try {
    const { stdout } = await execFileAsync('nmcli', ['-t', '-f', 'device,type,state', 'dev'])
    const netStatusList = []

    let cachedWifiChannels = null
    const getWifiChannels = async () => {
      if (cachedWifiChannels) return cachedWifiChannels
      const freqList = [{ value: 0, freq: 0, label: 'auto', band: 0 }]
      try {
        const { stdout: iwOut } = await execFileAsync('iw', ['list'])
        const allFreqs = iwOut.split('\n')
        for (const line of allFreqs) {
          if (line.includes('MHz') && line.includes('[')) {
            const parts = line.trim().split(/\s+/)
            if (parts.length >= 4 && parts[1] === '*' && parts[3] === 'MHz') {
              const freq = parts[2]
              const chStr = parts[4].replace('[', '').replace(']', '')
              const ch = parseInt(chStr, 10)
              if (!isNaN(ch)) {
                freqList.push({
                  value: ch,
                  freq: freq,
                  label: `${ch} (${freq} MHz)`,
                  band: (parseFloat(freq) < 3000) ? 'bg' : 'a'
                })
              }
            }
          }
        }
      } catch (_) {}
      cachedWifiChannels = freqList
      return freqList
    }

    const lines = stdout.split('\n').filter(Boolean)
    for (const item of lines) {
      const device = item.split(':')
      if (device.length >= 3 && device[1] !== 'loopback' && device[1] !== 'bridge' && device[1] !== 'wifi-p2p' && device[1] !== 'can0' && device[1] !== 'can1') {
        const freqList = device[1] === 'wifi' ? await getWifiChannels() : []
        netStatusList.push({
          value: device[0],
          label: `${device[0]} (${device[1]})`,
          type: device[1],
          state: device[2],
          channels: freqList,
          isDisabled: Boolean(device[2] === 'unavailable' && device[1] === 'wifi')
        })
      }
    }
    return callback(null, netStatusList)
  } catch (err) {
    console.error('exec error in getAdapters:', err)
    return callback(err.message || err)
  }
}

function getWirelessStatus (callback) {
  execFile('nmcli', ['-t', 'radio', 'wifi'], (error, stdout, stderr) => {
    if (stderr || error) {
      console.error(`exec error in getWirelessStatus: ${error || stderr}`)
      return callback(stderr || error)
    }
    return callback(null, stdout.trim() === 'enabled')
  })
}

function setWirelessStatus (status, callback) {
  const mode = status === true ? 'on' : 'off'
  execFile('sudo', ['nmcli', 'radio', 'wifi', mode], (error, stdout, stderr) => {
    if (stderr || error) {
      console.error(`exec error in setWirelessStatus: ${error || stderr}`)
      return callback(stderr || error)
    }
    getWirelessStatus(callback)
  })
}

function resetWifiWatchdogState () {
  const paths = [
    '/run/rpanion-wifi/connected-client',
    '/run/rpanion-wifi/disconnect-time',
    '/run/rpanion-wifi-connected-client',
    '/run/rpanion-wifi-disconnect-time'
  ]
  paths.forEach((p) => {
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p)
      }
    } catch (_) {}
  })
}

function activateConnection (conName, callback) {
  resetWifiWatchdogState()
  execFile('nmcli', ['-g', 'connection.id', 'connection', 'show', conName], (errShow, stdoutShow) => {
    const conId = (stdoutShow || '').trim()
    const autoVal = (conId === 'WiFiAP') ? 'no' : 'yes'
    execFile('sudo', ['nmcli', 'connection', 'mod', conName, 'connection.autoconnect', autoVal], (error, stdout, stderr) => {
      if (stderr || error) {
        console.error(`exec error in connection mod autoconnect: ${error || stderr}`)
        return callback(stderr || error)
      }
      execFile('sudo', ['nmcli', 'connection', 'up', conName], (errorUp, stdoutUp, stderrUp) => {
        if (stderrUp || errorUp) {
          const rawErr = stderrUp || (errorUp && errorUp.message) || 'Activation failed'
          console.error(`exec error in connection up: ${rawErr}`)

          let errMsg = rawErr
          if (rawErr.includes('IP configuration could not be reserved') || rawErr.includes('no available address, timeout')) {
            errMsg = 'DHCP timeout: No response from DHCP server. An IP address could not be obtained.'
          }

          execFile('nmcli', ['-g', 'connection.type', 'connection', 'show', conName], (errType, stdoutType) => {
            const conType = (stdoutType || '').trim()
            if (conType === '802-11-wireless') {
              execFile('sudo', ['nmcli', 'connection', 'up', 'WiFiAP'], () => {
                console.log('Rolled back to WiFiAP due to Wi-Fi activation failure of ' + conName)
                return callback(errMsg)
              })
            } else if (conId !== 'Ethernet-Server' && (conId === 'Ethernet-Client' || conType === '802-3-ethernet')) {
              execFile('sudo', ['nmcli', 'connection', 'up', 'Ethernet-Server'], () => {
                console.log('Rolled back to Ethernet-Server due to Ethernet activation failure of ' + conName)
                return callback(errMsg)
              })
            } else {
              return callback(errMsg)
            }
          })
        } else {
          console.log('Activated network: ' + conName)
          return callback(null, 'OK')
        }
      })
    })
  })
}

function deactivateConnection (conName, callback) {
  execFile('nmcli', ['-g', 'connection.id', 'connection', 'show', conName], (errShow, stdoutShow) => {
    const conId = (stdoutShow || '').trim()
    if (conId === 'Ethernet-Server' || conId === 'WiFiAP') {
      console.log('Blocked deactivation of fallback profile: ' + conId)
      return callback('Cannot deactivate fallback profile: ' + conId)
    }
    execFile('sudo', ['nmcli', 'connection', 'mod', conName, 'connection.autoconnect', 'no'], (error, stdout, stderr) => {
      if (stderr || error) {
        console.error(`exec error: ${error || stderr}`)
        return callback(stderr || error)
      }
      execFile('sudo', ['nmcli', 'connection', 'down', conName], (errDown, stdoutDown, stderrDown) => {
        if (stderrDown || errDown) {
          console.error(`exec error: ${errDown || stderrDown}`)
          return callback(stderrDown || errDown)
        }
        console.log('Deactivated network: ' + conName)
        return callback(null, 'OK')
      })
    })
  })
}

function getPrimaryWifiDevice (callback) {
  execFile('iw', ['dev'], (error, stdout) => {
    if (error) {
      return callback(error)
    }
    const match = (stdout || '').match(/Interface\s+([^\s]+)/)
    const device = match ? match[1] : null
    callback(null, device)
  })
}

function getWifiScan (callback) {
  const parseIw = (stdout) => {
    const rawNetworks = []
    let current = null

    ;(stdout || '').split('\n').forEach(line => {
      line = line.trim()

      if (line.startsWith('BSS ')) {
        if (current) rawNetworks.push(current)
        current = { ssid: null, signal: null, security: 'Open' }
        return
      }

      if (!current) return

      if (line.startsWith('SSID:')) {
        current.ssid = line.slice(5).trim()
        if (!/^[\x00-\x7F]*$/.test(current.ssid)) {
          current.ssid = null
          return
        }
      }

      if (line.startsWith('signal:')) {
        const dBm = parseFloat(line.split(' ')[1])
        current.signal = dBm
      }

      if (line.includes('RSN:')) {
        current.security = 'WPA2'
      } else if (line.includes('WPA:')) {
        current.security = 'WPA'
      } else if (line.includes('WEP:')) {
        current.security = 'WEP'
      }
    })
    if (current) rawNetworks.push(current)

    const deduped = new Map()
    rawNetworks.forEach(net => {
      if (!net.ssid || net.ssid === 'rpanion' || net.ssid === 'WiFiAP') return
      if (!deduped.has(net.ssid) || deduped.get(net.ssid).signal < net.signal) {
        deduped.set(net.ssid, net)
      }
    })

    return Array.from(deduped.values()).sort((a, b) => b.signal - a.signal)
  }

  const fallbackNmcli = () => {
    const parseNmcli = (stdout) => {
      const networks = []
      const seenSSIDs = new Set()

      ;(stdout || '').split('\n').forEach(line => {
        line = line.trim()
        if (!line) return

        const parts = line.split(/(?<!\\):/)
        if (parts.length >= 3) {
          const ssid = parts[0].replace(/\\:/g, ':').trim()
          if (!ssid || ssid === '--' || ssid === 'rpanion' || ssid === 'WiFiAP') return
          if (!/^[\x00-\x7F]*$/.test(ssid)) return
          if (seenSSIDs.has(ssid)) return
          seenSSIDs.add(ssid)

          const signalVal = parseInt(parts[1], 10)
          const rawSec = parts[2] || ''
          let security = 'Open'
          if (rawSec.includes('WPA3')) {
            security = 'WPA3'
          } else if (rawSec.includes('WPA2') || rawSec.includes('RSN')) {
            security = 'WPA2'
          } else if (rawSec.includes('WPA')) {
            security = 'WPA'
          } else if (rawSec.includes('WEP')) {
            security = 'WEP'
          }

          networks.push({
            ssid: ssid,
            signal: isNaN(signalVal) ? 0 : signalVal,
            security: security
          })
        }
      })
      return networks.sort((a, b) => b.signal - a.signal)
    }

    execFile('nmcli', ['-t', '-c', 'no', '-f', 'SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'auto'], (err, stdout) => {
      if (err && !stdout) {
        console.error(`nmcli wifi list error: ${err}`)
        return callback(err)
      }
      callback(null, parseNmcli(stdout))
    })
  }

  getPrimaryWifiDevice((error, device) => {
    if (error || !device) {
      return fallbackNmcli()
    }

    execFile('sudo', ['iw', 'dev', device, 'scan', 'ap-force'], (errIw, stdoutIw) => {
      if (errIw) {
        return fallbackNmcli()
      }
      const networks = parseIw(stdoutIw)
      if (networks.length === 0) {
        return fallbackNmcli()
      }
      callback(null, networks)
    })
  })
}

function addConnection (conNameStr, conType, conAdapter, conSettings, callback) {
  resetWifiWatchdogState()
  if (conType === 'wifi') {
    if (conSettings.priority === undefined || conSettings.priority === null || conSettings.priority === '') {
      conSettings.priority = conSettings.mode === 'ap' ? 0 : 100
    }
    const nmcliArgs = ['connection', 'add', 'type', conType, 'ifname', conAdapter, 'con-name', conNameStr, 'ssid', conSettings.ssid, '802-11-wireless.mode', conSettings.mode]
    if (conSettings.priority !== undefined && conSettings.priority !== null && conSettings.priority !== '') {
      nmcliArgs.push('connection.autoconnect-priority', conSettings.priority.toString())
    }
    if (conSettings.wpaType && conSettings.wpaType !== 'none') {
      nmcliArgs.push('802-11-wireless-security.key-mgmt', conSettings.wpaType, '802-11-wireless-security.psk', conSettings.password)
      if (conSettings.mode === 'ap') {
        nmcliArgs.push('802-11-wireless-security.proto', 'rsn', '802-11-wireless-security.pairwise', 'ccmp', '802-11-wireless-security.group', 'ccmp')
      }
    }
    if (conSettings.mode === 'ap') {
      nmcliArgs.push('802-11-wireless.band', conSettings.band)
      if (conSettings.channel && conSettings.channel !== '0') {
        nmcliArgs.push('802-11-wireless.channel', conSettings.channel)
      }
      nmcliArgs.push('ipv4.method', 'shared')
      nmcliArgs.push('ipv4.addresses', `${conSettings.ipaddress}/24`)
    } else {
      if (conSettings.ipaddresstype === 'auto') {
        nmcliArgs.push('ipv4.method', 'auto')
      } else if (conSettings.ipaddress && conSettings.subnet) {
        nmcliArgs.push('ipv4.addresses', `${conSettings.ipaddress}/${netmask2CIDR(conSettings.subnet)}`, 'ipv4.method', 'manual')
      }
    }

    execFile('sudo', ['nmcli', ...nmcliArgs], (error, stdout, stderr) => {
      if (stderr || error) {
        console.error(`exec error in addConnection: ${error || stderr}`)
        return callback(stderr || error)
      }
      execFile('nmcli', ['-g', 'connection.uuid', 'connection', 'show', conNameStr], (errUuid, stdoutUuid) => {
        if (errUuid) {
          return callback(null, 'AddOK')
        }
        return callback(null, stdoutUuid.trim())
      })
    })
  } else {
    if (conSettings.priority === undefined || conSettings.priority === null || conSettings.priority === '') {
      conSettings.priority = 100
    }
    execFile('sudo', ['nmcli', 'connection', 'add', 'type', conType, 'ifname', conAdapter, 'con-name', conNameStr, 'connection.autoconnect', 'no', 'connection.autoconnect-priority', conSettings.priority.toString()], (error, stdout, stderr) => {
      if (stderr || error) {
        console.error(`exec error in addConnection eth: ${error || stderr}`)
        return callback(stderr || error)
      }
      execFile('nmcli', ['-g', 'connection.uuid', 'connection', 'show', conNameStr], (errUuid, stdoutUuid) => {
        if (errUuid) {
          return callback(null, 'AddOK')
        }
        return callback(null, stdoutUuid.trim())
      })
    })
  }
}

async function editConnection (conName, conSettings, callback) {
  resetWifiWatchdogState()
  try {
    const { stdout: stdoutShow } = await execFileAsync('nmcli', ['-g', 'connection.id', 'connection', 'show', conName])
    const conId = (stdoutShow || '').trim()

    if (conId === 'Ethernet-Server' && conSettings.ipaddresstype && conSettings.ipaddresstype !== 'shared') {
      console.log('Blocked modification of IP mode for fallback profile: ' + conId)
      return callback('Cannot modify IP mode for fallback profile: ' + conId)
    }

    if (conSettings.priority !== undefined && conSettings.priority !== '') {
      const newPrio = parseInt(conSettings.priority, 10)
      if (conId === 'Ethernet-Server') {
        try {
          const { stdout: stdoutClient } = await execFileAsync('nmcli', ['-g', 'connection.autoconnect-priority', 'connection', 'show', 'Ethernet-Client'])
          const clientPrio = parseInt((stdoutClient || '').trim(), 10)
          if (!isNaN(clientPrio) && newPrio >= clientPrio) {
            return callback(`Ethernet-Server priority (${newPrio}) must be lower than Ethernet-Client priority (${clientPrio})`)
          }
        } catch (_) {}
      } else if (conId === 'Ethernet-Client') {
        try {
          const { stdout: stdoutServer } = await execFileAsync('nmcli', ['-g', 'connection.autoconnect-priority', 'connection', 'show', 'Ethernet-Server'])
          const serverPrio = parseInt((stdoutServer || '').trim(), 10)
          if (!isNaN(serverPrio) && newPrio <= serverPrio) {
            return callback(`Ethernet-Client priority (${newPrio}) must be higher than Ethernet-Server priority (${serverPrio})`)
          }
        } catch (_) {}
      }
    }

    const modArgs = ['connection', 'mod', conName]

    if (conSettings.attachedIface !== undefined) {
      let iface = conSettings.attachedIface
      if (!iface || iface === '&quot;&quot;' || iface === 'undefined' || iface === '""' || iface === '\"\"') {
        iface = ''
      }
      modArgs.push('connection.interface-name', iface)
    }

    if (conSettings.priority !== undefined && conSettings.priority !== null && conSettings.priority !== '') {
      modArgs.push('connection.autoconnect-priority', conSettings.priority.toString())
    }

    if (!conSettings.ssid || conSettings.mode === 'infrastructure') {
      if (conSettings.ipaddresstype === 'auto') {
        modArgs.push('ipv4.method', 'auto', 'ipv4.addresses', '')
      } else if (conSettings.ipaddress && conSettings.subnet) {
        const cidr = netmask2CIDR(conSettings.subnet) || 24
        modArgs.push('ipv4.addresses', `${conSettings.ipaddress}/${cidr}`, 'ipv4.method', conSettings.ipaddresstype)
      }
    }

    if (conSettings.mode === 'ap') {
      if (conSettings.ssid) modArgs.push('802-11-wireless.ssid', conSettings.ssid)
      if (conSettings.band) modArgs.push('802-11-wireless.band', conSettings.band)
      if (conSettings.channel !== undefined) {
        modArgs.push('802-11-wireless.channel', conSettings.channel !== '0' ? conSettings.channel.toString() : '')
      }
      if (conSettings.ipaddress) {
        modArgs.push('ipv4.addresses', `${conSettings.ipaddress}/24`)
      }
      if (conSettings.wpaType && conSettings.wpaType !== 'none') {
        modArgs.push('802-11-wireless-security.group', 'ccmp', '802-11-wireless-security.wps-method', '1')
      }
    } else if (conSettings.mode === 'infrastructure' && conSettings.ssid) {
      modArgs.push('802-11-wireless.ssid', conSettings.ssid)
    }

    if (conSettings.mode === 'infrastructure' || conSettings.mode === 'ap') {
      if (conSettings.wpaType && conSettings.wpaType !== 'none') {
        modArgs.push('802-11-wireless-security.key-mgmt', conSettings.wpaType)
        if (conSettings.password) {
          modArgs.push('802-11-wireless-security.pairwise', 'ccmp', '802-11-wireless-security.psk', conSettings.password)
        }
      }
    }

    if (modArgs.length > 3) {
      await execFileAsync('sudo', ['nmcli', ...modArgs])
    }

    if ((conSettings.mode === 'infrastructure' || conSettings.mode === 'ap') && conSettings.wpaType === 'none') {
      try {
        await execFileAsync('sudo', ['nmcli', 'connection', 'mod', conName, 'remove', '802-11-wireless-security'])
      } catch (_) {}
    }

    const { stdout: stdoutDev } = await execFileAsync('nmcli', ['-t', '-f', 'GENERAL.STATE', 'connection', 'show', conName]).catch(() => ({ stdout: '' }))
    if ((stdoutDev || '').includes('activated')) {
      console.log('Re-applying modified active connection: ' + conName)
      await execFileAsync('sudo', ['nmcli', 'connection', 'up', conName]).catch(errUp => {
        console.warn('Warning: nmcli connection up returned: ' + errUp)
      })
    }

    return callback(null, 'EditOK')
  } catch (err) {
    console.error('Error in editConnection:', err)
    return callback(err.message || err)
  }
}

function deleteConnection (conName, callback) {
  resetWifiWatchdogState()
  execFile('nmcli', ['-g', 'connection.id', 'connection', 'show', conName], (errShow, stdoutShow) => {
    const conId = (stdoutShow || '').trim()
    if (conId === 'Ethernet-Server' || conId === 'Ethernet-Client' || conId === 'WiFiAP') {
      console.log('Blocked deletion of system profile: ' + conId)
      return callback('Cannot delete system profile: ' + conId)
    }
    execFile('sudo', ['nmcli', 'connection', 'delete', conName], (error, stdout, stderr) => {
      if (stderr || error) {
        console.error(`exec error in deleteConnection: ${error || stderr}`)
        return callback(stderr || error)
      }
      console.log('Deleted network: ' + conName)
      return callback(null, 'OK')
    })
  })
}

async function getConnections (callback) {
  try {
    const { stdout: output } = await execFileAsync('nmcli', ['-t', '-f', 'NAME,UUID,TYPE,DEVICE', 'connection', 'show'])
    const allConns = output.toString().split('\n').filter(Boolean)
    const conStatusList = []
    const uuids = []

    allConns.forEach((item) => {
      const connection = item.split(':')
      if (connection.length >= 3) {
        const uuid = connection[1]
        const state = (connection[3] === '' || connection[3] === '--') ? '' : (connection[3] || '')
        conStatusList.push({
          value: uuid,
          label: '',
          labelPre: connection[0],
          type: connection[2],
          state: state,
          attachedIface: ''
        })
        if (uuid) {
          uuids.push(uuid)
        }
      }
    })

    if (uuids.length > 0) {
      let rawOut = ''
      try {
        const res = await execFileAsync('nmcli', ['-s', '-t', '-f', 'connection.uuid,connection.interface-name', 'connection', 'show', ...uuids])
        rawOut = res.stdout || ''
      } catch (errBatch) {
        rawOut = (errBatch && errBatch.stdout) || ''
      }

      if (rawOut) {
        const ifaceMap = new Map()
        let currentUuid = null
        for (const line of rawOut.split('\n')) {
          if (line.startsWith('connection.uuid:')) {
            currentUuid = line.slice('connection.uuid:'.length).trim()
          } else if (line.startsWith('connection.interface-name:') && currentUuid) {
            const iface = line.slice('connection.interface-name:'.length).trim()
            ifaceMap.set(currentUuid, iface)
            currentUuid = null
          }
        }
        conStatusList.forEach(conn => {
          if (ifaceMap.has(conn.value)) {
            conn.attachedIface = ifaceMap.get(conn.value)
          }
        })
      }
    }

    return callback(null, conStatusList)
  } catch (e) {
    console.error('exec error in getConnections: ' + e)
    return callback(e)
  }
}

function getConnectionDetails (conName, callback) {
  const queryArgs = ['-s', '-t', '-f', 'ipv4.addresses,802-11-wireless.band,ipv4.method,IP4.ADDRESS,802-11-wireless.ssid,802-11-wireless.mode,802-11-wireless-security.key-mgmt,802-11-wireless-security.psk,connection.interface-name,802-11-wireless.channel,connection.autoconnect-priority', 'connection', 'show', conName]

  const parseDetails = (stdout) => {
    const ret = { DHCP: 'auto', IP: '', subnet: '', mode: '', wpaType: 'none', password: '', priority: 0 }
    let configuredIP = ''
    let configuredSubnet = ''
    let activeIP = ''
    let activeSubnet = ''

    stdout.split('\n').forEach(function (item) {
      const parts = item.split(':')
      const key = parts[0]
      const val = parts.slice(1).join(':')

      if (key === '802-11-wireless.ssid') {
        ret.ssid = val
      } else if (key === '802-11-wireless.band') {
        ret.band = val || 'bg'
      } else if (key === 'ipv4.method') {
        ret.DHCP = val
      } else if (key === 'ipv4.addresses' && val !== '') {
        configuredIP = val.split('/')[0]
        configuredSubnet = CIDR2netmask(val.split('/')[1])
      } else if (key === 'IP4.ADDRESS[1]' && val !== '') {
        activeIP = val.split('/')[0]
        activeSubnet = CIDR2netmask(val.split('/')[1])
      } else if (key === '802-11-wireless.mode') {
        ret.mode = val
      } else if (key === '802-11-wireless-security.key-mgmt') {
        ret.wpaType = val
      } else if (key === '802-11-wireless-security.psk') {
        ret.password = val
      } else if (key === 'connection.interface-name') {
        ret.attachedIface = val
      } else if (key === '802-11-wireless.channel') {
        ret.channel = val
      } else if (key === 'connection.autoconnect-priority') {
        ret.priority = parseInt(val, 10) || 0
      }
    })

    if (ret.DHCP === 'auto') {
      ret.IP = activeIP || configuredIP
      ret.subnet = activeSubnet || configuredSubnet
    } else {
      ret.IP = configuredIP || activeIP
      ret.subnet = configuredSubnet || activeSubnet
    }

    return ret
  }

  execFile('nmcli', queryArgs, (error, stdout, stderr) => {
    if (!error && !stderr) {
      return callback(null, parseDetails(stdout))
    }
    execFile('sudo', ['nmcli', ...queryArgs], (errorSudo, stdoutSudo, stderrSudo) => {
      if (stderrSudo || errorSudo) {
        console.error(`exec error in getConnectionDetails: ${errorSudo || stderrSudo}`)
        return callback(stderrSudo || errorSudo)
      }
      return callback(null, parseDetails(stdoutSudo))
    })
  })
}

function CIDR2netmask (bitCountstr) {
  const mask = []
  let bitCount = parseInt(bitCountstr, 10)
  for (let i = 0; i < 4; i++) {
    const n = Math.min(bitCount, 8)
    mask.push(256 - Math.pow(2, 8 - n))
    bitCount -= n
  }
  return mask.join('.')
}

function netmask2CIDR (mask) {
  let cidr = ''
  for (const m of (mask || '').split('.')) {
    if (parseInt(m, 10) > 255) { throw 'ERROR: Invalid Netmask' }
    if (parseInt(m, 10) > 0 && parseInt(m, 10) < 128) { throw 'ERROR: Invalid Netmask' }
    cidr += (m >>> 0).toString(2)
  }
  if (cidr.substring(cidr.search('0'), 32).search('1') !== -1) {
    throw 'ERROR: Invalid Netmask ' + mask
  }
  return cidr.split('1').length - 1
}

async function getPrimaryEthernetDevice () {
  try {
    const { stdout } = await execFileAsync('nmcli', ['-t', '-f', 'DEVICE,TYPE', 'dev'])
    const lines = stdout.split('\n').filter(Boolean)
    for (const line of lines) {
      const parts = line.split(':')
      if (parts[1] === 'ethernet') {
        return parts[0]
      }
    }
  } catch (_) {}
  try {
    const ifaces = fs.readdirSync('/sys/class/net')
    const eth = ifaces.find(name => name.startsWith('eth') || name.startsWith('end') || name.startsWith('en'))
    if (eth) return eth
  } catch (_) {}
  return 'eth0'
}

async function getEthernetAliases (callback) {
  let aliases = settings.value('ethernet.aliases', [])
  if (!Array.isArray(aliases)) {
    aliases = []
  }

  const oldEnabled = Boolean(settings.value('ethernet.alias.enabled', false))
  const oldIp = settings.value('ethernet.alias.ip', '')
  const oldSubnet = settings.value('ethernet.alias.subnet', '255.255.255.0')
  if (aliases.length === 0 && oldEnabled && oldIp) {
    aliases.push({ id: 'alias-' + Date.now(), ip: oldIp, subnet: oldSubnet })
    settings.setValue('ethernet.aliases', aliases)
  }

  const ethIface = await getPrimaryEthernetDevice()
  execFile('ip', ['-o', '-4', 'addr', 'show', 'dev', ethIface], (err, stdout) => {
    const out = stdout || ''
    const result = aliases.map(item => ({
      id: item.id || (item.ip + '-' + item.subnet),
      ip: item.ip,
      subnet: item.subnet || '255.255.255.0',
      active: out.includes(` ${item.ip}/`)
    }))
    return callback(null, result)
  })
}

async function setEthernetAliases (aliasesList, callback) {
  if (!Array.isArray(aliasesList)) {
    return callback(new Error('Invalid aliases list'))
  }

  const ethIface = await getPrimaryEthernetDevice()
  const oldAliases = settings.value('ethernet.aliases', [])
  const validList = aliasesList.filter(item => item && item.ip).map((item, idx) => ({
    id: item.id || ('alias-' + idx + '-' + Date.now()),
    ip: item.ip.trim(),
    subnet: (item.subnet || '255.255.255.0').trim()
  }))

  settings.setValue('ethernet.aliases', validList)

  const aliasEntries = []
  validList.forEach(item => {
    try {
      const cidr = netmask2CIDR(item.subnet) || 24
      aliasEntries.push(`${item.ip}/${cidr}`)
    } catch (_) {}
  })

  const configContent = `ETH_ALIASES="${aliasEntries.join(' ')}"\n`
  try {
    fs.writeFileSync('/etc/default/rpanion-eth-alias', configContent)
  } catch (_) {
    try {
      fs.writeFileSync('/tmp/rpanion-eth-alias', configContent)
      await execFileAsync('sudo', ['cp', '/tmp/rpanion-eth-alias', '/etc/default/rpanion-eth-alias'])
      await execFileAsync('sudo', ['chown', 'rpanion:rpanion', '/etc/default/rpanion-eth-alias'])
      try { fs.unlinkSync('/tmp/rpanion-eth-alias') } catch (_) {}
    } catch (err2) {
      console.error('Error writing /etc/default/rpanion-eth-alias: ' + err2)
    }
  }

  // Remove old IPs that are no longer in validList
  if (Array.isArray(oldAliases)) {
    for (const oldItem of oldAliases) {
      if (!validList.some(newItem => newItem.ip === oldItem.ip)) {
        try {
          const cidr = netmask2CIDR(oldItem.subnet) || 24
          await execFileAsync('sudo', ['ip', 'addr', 'del', `${oldItem.ip}/${cidr}`, 'dev', ethIface]).catch(() => {})
        } catch (_) {}
      }
    }
  }

  // Add new IPs on primary ethernet interface
  for (const entry of aliasEntries) {
    try {
      await execFileAsync('sudo', ['ip', 'addr', 'add', entry, 'dev', ethIface]).catch(() => {})
    } catch (_) {}
  }

  return callback(null, 'OK')
}

function getEthernetAlias (callback) {
  getEthernetAliases((err, list) => {
    if (err) return callback(err)
    if (list && list.length > 0) {
      return callback(null, { enabled: true, ip: list[0].ip, subnet: list[0].subnet, active: list[0].active })
    }
    return callback(null, { enabled: false, ip: '', subnet: '255.255.255.0', active: false })
  })
}

function setEthernetAlias (aliasSettings, callback) {
  if (aliasSettings.enabled && aliasSettings.ip) {
    return setEthernetAliases([{ ip: aliasSettings.ip, subnet: aliasSettings.subnet || '255.255.255.0' }], callback)
  } else {
    return setEthernetAliases([], callback)
  }
}

function applyEthernetAlias () {
  // Maintained for backward compatibility; aliases managed via setEthernetAliases and dispatcher
}

function getWifiSettings (callback) {
  let apAutoReconnect = true
  try {
    apAutoReconnect = settings.value('wifi.apAutoReconnect', true)
  } catch (_) {}
  if (fs.existsSync('/etc/default/rpanion-wifi')) {
    try {
      const content = fs.readFileSync('/etc/default/rpanion-wifi', 'utf8')
      const match = content.match(/AP_AUTO_RECONNECT=(true|false)/i)
      if (match) {
        apAutoReconnect = match[1].toLowerCase() === 'true'
      }
    } catch (_) {}
  }
  callback(null, { apAutoReconnect })
}

async function setWifiSettings (newSettings, callback) {
  const apAutoReconnect = Boolean(newSettings.apAutoReconnect !== false)
  try {
    settings.setValue('wifi.apAutoReconnect', apAutoReconnect)
  } catch (_) {}

  const configContent = `AP_AUTO_RECONNECT=${apAutoReconnect}\n`
  try {
    fs.writeFileSync('/etc/default/rpanion-wifi', configContent)
  } catch (_) {
    try {
      fs.writeFileSync('/tmp/rpanion-wifi', configContent)
      await execFileAsync('sudo', ['cp', '/tmp/rpanion-wifi', '/etc/default/rpanion-wifi'])
      await execFileAsync('sudo', ['chown', 'rpanion:rpanion', '/etc/default/rpanion-wifi'])
      try { fs.unlinkSync('/tmp/rpanion-wifi') } catch (_) {}
    } catch (err2) {
      console.error('Error writing /etc/default/rpanion-wifi: ' + err2)
    }
  }

  callback(null, { apAutoReconnect })
}

module.exports = {
  getAdapters,
  getConnections,
  getConnectionDetails,
  getPrimaryEthernetDevice,
  activateConnection,
  deleteConnection,
  editConnection,
  addConnection,
  deactivateConnection,
  getWirelessStatus,
  setWirelessStatus,
  getWifiScan,
  getEthernetAlias,
  setEthernetAlias,
  getEthernetAliases,
  setEthernetAliases,
  applyEthernetAlias,
  resetWifiWatchdogState,
  getWifiSettings,
  setWifiSettings
}
