/*
 * NetworkManager operations used by the network routes.
 * All exports are async. nmcli access goes through ./nmcli; argument
 * building and output parsing live in ./networkArgs.
 */
const { execFile } = require('child_process')
const util = require('util')
const fs = require('fs')
const settings = require('settings-store')
const nmcli = require('./nmcli')
const { toSubnet, prefixToNetmask } = require('./ipv4Subnet')
const wifiWatchdogState = require('./wifiWatchdogState')
const {
  PROFILE,
  profileRole,
  parseIwChannels,
  parseIwScan,
  parseNmcliWifiList,
  buildIpv4Args,
  buildWifiArgs
} = require('./networkArgs')

const execFileAsync = util.promisify(execFile)

const ALIAS_CONFIG_FILE = '/etc/default/rpanion-eth-alias'
const DEFAULT_NETMASK = '255.255.255.0'
const IGNORED_DEVICE_TYPES = ['loopback', 'bridge', 'wifi-p2p']
// SSIDs broadcast by this device's own access point
const OWN_AP_SSIDS = ['rpanion', PROFILE.WIFI_AP]

// Error caused by the request itself; routes keep its HTTP status
function requestError (message, status = 409) {
  const err = new Error(message)
  err.status = status
  return err
}

// Checks a static address before it is applied: ({ip, prefix}) => error message or null
let staticAddressGuard = null
function setStaticAddressGuard (guard) {
  staticAddressGuard = guard
}

function checkStaticAddress (subnet) {
  return subnet && staticAddressGuard ? staticAddressGuard(subnet) : null
}

// Throws when the profile does not exist, so protected-profile checks cannot be skipped
async function getProfileInfo (conName) {
  const out = await nmcli.run(['-g', 'connection.id,connection.type', 'connection', 'show', conName])
  const [id = '', type = ''] = out.split('\n')
  return { id, type }
}

// Hardware channel list does not change at runtime
let cachedWifiChannels = null
async function getWifiChannels () {
  if (!cachedWifiChannels) {
    let channels = []
    try {
      const { stdout } = await execFileAsync('iw', ['list'])
      channels = parseIwChannels(stdout)
    } catch (err) {
      console.error('Cannot read Wi-Fi channels: ' + err.message)
    }
    cachedWifiChannels = [{ value: 0, freq: 0, label: 'auto', band: 0 }, ...channels]
  }
  return cachedWifiChannels
}

async function getAdapters () {
  const out = await nmcli.run(['-t', '-f', 'DEVICE,TYPE,STATE', 'dev'])
  const adapters = []
  for (const line of out.split('\n').filter(Boolean)) {
    const [device, type, state] = nmcli.parseTerseRow(line)
    if (!type || IGNORED_DEVICE_TYPES.includes(type) || device.startsWith('can')) continue
    adapters.push({
      value: device,
      label: `${device} (${type})`,
      type,
      state,
      channels: type === 'wifi' ? await getWifiChannels() : [],
      isDisabled: type === 'wifi' && state === 'unavailable'
    })
  }
  return adapters
}

async function getWirelessStatus () {
  return (await nmcli.run(['-t', 'radio', 'wifi'])).trim() === 'enabled'
}

async function setWirelessStatus (enabled) {
  await nmcli.run(['radio', 'wifi', enabled ? 'on' : 'off'], { sudo: true })
  return getWirelessStatus()
}

function resetWifiWatchdogState () {
  wifiWatchdogState.reset()
}

function describeActivationError (message) {
  if (message.includes('IP configuration could not be reserved') || message.includes('no available address, timeout')) {
    return 'DHCP timeout: No response from DHCP server. An IP address could not be obtained.'
  }
  return message
}

// Profile that restores connectivity after a failed activation, or null
function fallbackProfileFor (profile) {
  if (profile.type === '802-11-wireless') return PROFILE.WIFI_AP
  if (profile.type === '802-3-ethernet' && profile.id !== PROFILE.ETH_SERVER) return PROFILE.ETH_SERVER
  return null
}

async function activateConnection (conName) {
  const profile = await getProfileInfo(conName)
  resetWifiWatchdogState()
  try {
    await nmcli.run(['connection', 'up', conName], { sudo: true })
  } catch (err) {
    console.error(`Activation of ${conName} failed: ${err.message}`)
    const fallback = fallbackProfileFor(profile)
    if (fallback) {
      await nmcli.run(['connection', 'up', fallback], { sudo: true })
        .then(() => console.log(`Rolled back to ${fallback} after activation failure of ${conName}`))
        .catch(errUp => console.error(`Rollback to ${fallback} failed: ${errUp.message}`))
    }
    throw new Error(describeActivationError(err.message))
  }
  // The AP is started on demand by the watchdog; it must not autoconnect over client networks.
  // A user-started AP is held so the watchdog does not switch back to a client network.
  const isAp = profile.id === PROFILE.WIFI_AP
  await nmcli.run(['connection', 'mod', conName, 'connection.autoconnect', isAp ? 'no' : 'yes'], { sudo: true })
  wifiWatchdogState.setManualHold(isAp)
  console.log('Activated network: ' + conName)
  return 'OK'
}

async function deactivateConnection (conName) {
  const profile = await getProfileInfo(conName)
  if (profile.id === PROFILE.ETH_SERVER || profile.id === PROFILE.WIFI_AP) {
    throw requestError('Cannot deactivate fallback profile: ' + profile.id)
  }
  await nmcli.run(['connection', 'mod', conName, 'connection.autoconnect', 'no'], { sudo: true })
  await nmcli.run(['connection', 'down', conName], { sudo: true })
  console.log('Deactivated network: ' + conName)
  return 'OK'
}

async function deleteConnection (conName) {
  const profile = await getProfileInfo(conName)
  if (profileRole(profile.id)) {
    throw requestError('Cannot delete system profile: ' + profile.id)
  }
  resetWifiWatchdogState()
  await nmcli.run(['connection', 'delete', conName], { sudo: true })
  console.log('Deleted network: ' + conName)
  return 'OK'
}

async function getWifiScan () {
  try {
    const { stdout: devOut } = await execFileAsync('iw', ['dev'])
    const match = devOut.match(/Interface\s+(\S+)/)
    if (match) {
      const { stdout } = await execFileAsync('sudo', ['iw', 'dev', match[1], 'scan', 'ap-force'])
      const networks = parseIwScan(stdout, OWN_AP_SSIDS)
      if (networks.length > 0) return networks
    }
  } catch (err) {
    console.log('iw scan unavailable, using nmcli: ' + err.message)
  }
  const out = await nmcli.run(['-t', '-f', 'SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'auto'])
  return parseNmcliWifiList(out, OWN_AP_SSIDS)
}

function normalisePriority (priority) {
  return priority === undefined || priority === null || priority === '' ? null : String(priority)
}

async function addConnection (conName, conType, conAdapter, conSettings) {
  const ipv4 = buildIpv4Args(conSettings, { isNew: true })
  const typeArgs = conType === 'wifi' ? buildWifiArgs(conSettings, { isNew: true }) : []
  const conflict = checkStaticAddress(ipv4.address)
  if (conflict) {
    throw requestError(conflict)
  }
  const priority = normalisePriority(conSettings.priority) || (conType === 'wifi' && conSettings.mode === 'ap' ? '0' : '100')
  const args = ['connection', 'add', 'type', conType, 'ifname', conAdapter, 'con-name', conName,
    'connection.autoconnect-priority', priority]
  if (conType !== 'wifi') {
    // Extra wired profiles must not take the port over from Ethernet-Client/Ethernet-Server on boot
    args.push('connection.autoconnect', 'no')
  }
  args.push(...typeArgs, ...ipv4.args)

  resetWifiWatchdogState()
  const out = await nmcli.run(args, { sudo: true })
  const match = out.match(/\(([0-9a-f-]{36})\)/)
  if (!match) {
    throw new Error('Profile created, but nmcli did not report its UUID: ' + out.trim())
  }
  return match[1]
}

async function checkFallbackPriority (profileId, newPriority) {
  const other = profileId === PROFILE.ETH_SERVER ? PROFILE.ETH_CLIENT : PROFILE.ETH_SERVER
  let otherPriority
  try {
    otherPriority = parseInt((await nmcli.run(['-g', 'connection.autoconnect-priority', 'connection', 'show', other])).trim(), 10)
  } catch (_) {
    return
  }
  if (isNaN(otherPriority)) return
  // Ethernet-Client must win autoconnect over Ethernet-Server, otherwise DHCP client never runs
  if (profileId === PROFILE.ETH_SERVER && newPriority >= otherPriority) {
    throw requestError(`Ethernet-Server priority (${newPriority}) must be lower than Ethernet-Client priority (${otherPriority})`)
  }
  if (profileId === PROFILE.ETH_CLIENT && newPriority <= otherPriority) {
    throw requestError(`Ethernet-Client priority (${newPriority}) must be higher than Ethernet-Server priority (${otherPriority})`)
  }
}

async function editConnection (conName, conSettings) {
  const ipv4 = buildIpv4Args(conSettings)
  const conflict = checkStaticAddress(ipv4.address)
  if (conflict) {
    throw requestError(conflict)
  }
  const profile = await getProfileInfo(conName)
  if (profile.id === PROFILE.ETH_SERVER && conSettings.ipaddresstype && conSettings.ipaddresstype !== 'shared') {
    throw requestError('Cannot modify IP mode for fallback profile: ' + profile.id)
  }
  const priority = normalisePriority(conSettings.priority)
  if (priority !== null && (profile.id === PROFILE.ETH_SERVER || profile.id === PROFILE.ETH_CLIENT)) {
    await checkFallbackPriority(profile.id, parseInt(priority, 10))
  }

  const modArgs = []
  if (conSettings.attachedIface !== undefined) {
    modArgs.push('connection.interface-name', conSettings.attachedIface || '')
  }
  if (priority !== null) {
    modArgs.push('connection.autoconnect-priority', priority)
  }
  if (conSettings.mode) {
    modArgs.push(...buildWifiArgs(conSettings))
  }
  modArgs.push(...ipv4.args)

  resetWifiWatchdogState()
  if (modArgs.length > 0) {
    await nmcli.run(['connection', 'mod', conName, ...modArgs], { sudo: true })
  }
  if (conSettings.mode && conSettings.wpaType === 'none') {
    await nmcli.run(['connection', 'mod', conName, 'remove', '802-11-wireless-security'], { sudo: true })
      .catch(() => {})
  }

  const state = await nmcli.run(['-t', '-f', 'GENERAL.STATE', 'connection', 'show', conName]).catch(() => '')
  if (state.includes('activated')) {
    console.log('Re-applying modified active connection: ' + conName)
    try {
      await nmcli.run(['connection', 'up', conName], { sudo: true })
    } catch (err) {
      throw new Error('Settings saved, but re-activation failed: ' + describeActivationError(err.message))
    }
  }
  return 'EditOK'
}

async function getConnections () {
  const out = await nmcli.run(['-t', '-f', 'NAME,UUID,TYPE,DEVICE', 'connection', 'show'])
  const connections = out.split('\n').filter(Boolean).map((line) => {
    const [name, uuid, type, device = ''] = nmcli.parseTerseRow(line)
    return {
      value: uuid,
      label: '',
      labelPre: name,
      type,
      state: device === '--' ? '' : device,
      attachedIface: '',
      role: profileRole(name)
    }
  }).filter(con => con.value)

  if (connections.length > 0) {
    const details = await nmcli.run(['-s', '-t', '-f', 'connection.uuid,connection.interface-name', 'connection', 'show',
      ...connections.map(con => con.value)]).catch(err => err.stdout || '')
    const ifaceByUuid = new Map(nmcli.parseMultiline(details, 'connection.uuid')
      .map(rec => [rec['connection.uuid'], rec['connection.interface-name'] || '']))
    for (const con of connections) {
      con.attachedIface = ifaceByUuid.get(con.value) || ''
    }
  }
  return connections
}

const DETAIL_FIELDS = 'ipv4.addresses,802-11-wireless.band,ipv4.method,IP4.ADDRESS,802-11-wireless.ssid,802-11-wireless.mode,' +
  '802-11-wireless-security.key-mgmt,802-11-wireless-security.psk,connection.interface-name,802-11-wireless.channel,connection.autoconnect-priority'

function parseConnectionDetails (stdout) {
  const ret = { DHCP: 'auto', IP: '', subnet: '', mode: '', wpaType: 'none', password: '', priority: 0 }
  const split = (cidr) => [cidr.split('/')[0], prefixToNetmask(cidr.split('/')[1]) || '']
  let configured = ['', '']
  let active = ['', '']
  for (const line of stdout.split('\n')) {
    const sep = line.indexOf(':')
    if (sep < 0) continue
    const key = line.slice(0, sep)
    const val = line.slice(sep + 1)
    if (key === '802-11-wireless.ssid') ret.ssid = val
    else if (key === '802-11-wireless.band') ret.band = val || 'bg'
    else if (key === 'ipv4.method') ret.DHCP = val
    else if (key === 'ipv4.addresses' && val) configured = split(val.split(',')[0].trim())
    else if (key === 'IP4.ADDRESS[1]' && val) active = split(val)
    else if (key === '802-11-wireless.mode') ret.mode = val
    else if (key === '802-11-wireless-security.key-mgmt') ret.wpaType = val
    else if (key === '802-11-wireless-security.psk') ret.password = val
    else if (key === 'connection.interface-name') ret.attachedIface = val
    else if (key === '802-11-wireless.channel') ret.channel = val
    else if (key === 'connection.autoconnect-priority') ret.priority = parseInt(val, 10) || 0
  }
  const [ip, subnet] = ret.DHCP === 'auto' ? (active[0] ? active : configured) : (configured[0] ? configured : active)
  ret.IP = ip
  ret.subnet = subnet
  return ret
}

async function getConnectionDetails (conName) {
  const args = ['-s', '-t', '-f', DETAIL_FIELDS, 'connection', 'show', conName]
  // Secrets (psk) are only returned with root rights
  const out = await nmcli.run(args, { sudo: true }).catch(() => nmcli.run(args))
  return parseConnectionDetails(out)
}

// Interface the Ethernet profiles are bound to; aliases are applied there
async function getPrimaryEthernetDevice () {
  try {
    const iface = (await nmcli.run(['-g', 'connection.interface-name', 'connection', 'show', PROFILE.ETH_CLIENT])).trim()
    if (iface) return iface
  } catch (_) {}
  try {
    const out = await nmcli.run(['-t', '-f', 'DEVICE,TYPE', 'dev'])
    const row = out.split('\n').map(nmcli.parseTerseRow).find(([, type]) => type === 'ethernet')
    if (row) return row[0]
  } catch (_) {}
  return 'eth0'
}

// Converts the single-alias settings of earlier fork versions; call once at startup
function migrateLegacyAliasSettings () {
  const aliases = settings.value('ethernet.aliases', [])
  const oldIp = settings.value('ethernet.alias.ip', '')
  if ((!Array.isArray(aliases) || aliases.length === 0) && settings.value('ethernet.alias.enabled', false) && oldIp) {
    settings.setValue('ethernet.aliases', [{ id: 'alias-' + Date.now(), ip: oldIp, subnet: settings.value('ethernet.alias.subnet', DEFAULT_NETMASK) }])
  }
}

async function getEthernetAliases () {
  const aliases = settings.value('ethernet.aliases', [])
  if (!Array.isArray(aliases) || aliases.length === 0) return []
  const ethIface = await getPrimaryEthernetDevice()
  const { stdout } = await execFileAsync('ip', ['-o', '-4', 'addr', 'show', 'dev', ethIface]).catch(() => ({ stdout: '' }))
  return aliases.map(item => ({
    id: item.id || (item.ip + '-' + item.subnet),
    ip: item.ip,
    subnet: item.subnet || DEFAULT_NETMASK,
    active: stdout.includes(` ${item.ip}/`)
  }))
}

/**
 * Validates alias entries before they reach the dispatcher config file.
 * @param {Array<{id?: string, ip: string, subnet?: string}>} list
 * @param {string[]} reservedIps addresses owned by NetworkManager profiles;
 *   an alias equal to one of them would be removed with `ip addr del` later
 * @returns {{aliases: Array<{id, ip, subnet}>, entries: string[]}}
 */
function validateAliasList (list, reservedIps = []) {
  if (!Array.isArray(list)) {
    throw requestError('Invalid aliases list', 422)
  }
  const aliases = []
  const entries = []
  list.forEach((item, idx) => {
    const ip = typeof (item && item.ip) === 'string' ? item.ip.trim() : ''
    const mask = typeof (item && item.subnet) === 'string' && item.subnet.trim() ? item.subnet.trim() : DEFAULT_NETMASK
    const subnet = ip.includes('/') ? null : toSubnet(ip, mask)
    if (!subnet) {
      throw requestError(`Invalid alias address: ${ip || '(empty)'} / ${mask}`, 422)
    }
    if (reservedIps.includes(subnet.ip)) {
      throw requestError(`Alias ${subnet.ip} is already assigned by a network profile`)
    }
    aliases.push({ id: item.id || ('alias-' + idx + '-' + Date.now()), ip: subnet.ip, subnet: mask })
    entries.push(`${subnet.ip}/${subnet.prefix}`)
  })
  return { aliases, entries }
}

async function setEthernetAliases (aliasesList) {
  const reservedIps = (await getProfileStaticSubnets()).map(subnet => subnet.ip)
  const validated = validateAliasList(aliasesList, reservedIps)
  for (const alias of validated.aliases) {
    const conflict = checkStaticAddress(toSubnet(alias.ip, alias.subnet))
    if (conflict) {
      throw requestError(conflict)
    }
  }

  try {
    await fs.promises.writeFile(ALIAS_CONFIG_FILE, `ETH_ALIASES="${validated.entries.join(' ')}"\n`)
  } catch (err) {
    throw new Error(`Cannot write ${ALIAS_CONFIG_FILE}: ${err.message}`)
  }

  const oldAliases = settings.value('ethernet.aliases', [])
  settings.setValue('ethernet.aliases', validated.aliases)

  // Apply to the running interface; the dispatcher re-applies the file on every profile up
  const ethIface = await getPrimaryEthernetDevice()
  const failures = []
  for (const oldItem of Array.isArray(oldAliases) ? oldAliases : []) {
    const oldSubnet = oldItem && toSubnet(oldItem.ip, oldItem.subnet || DEFAULT_NETMASK)
    if (!oldSubnet || reservedIps.includes(oldSubnet.ip) || validated.aliases.some(a => a.ip === oldSubnet.ip)) {
      continue
    }
    await execFileAsync('sudo', ['ip', 'addr', 'del', `${oldSubnet.ip}/${oldSubnet.prefix}`, 'dev', ethIface])
      .catch(err => { if (!/Cannot assign/.test(err.stderr || '')) failures.push(err.stderr || err.message) })
  }
  for (const entry of validated.entries) {
    await execFileAsync('sudo', ['ip', 'addr', 'add', entry, 'dev', ethIface])
      .catch(err => { if (!/File exists/.test(err.stderr || '')) failures.push(err.stderr || err.message) })
  }
  if (failures.length > 0) {
    throw new Error(`Aliases saved, but applying them to ${ethIface} failed: ${failures.join('; ').trim()}`)
  }
  return 'OK'
}

async function getWifiSettings () {
  return wifiWatchdogState.readConfig()
}

async function setWifiSettings (newSettings) {
  const apAutoReconnect = newSettings.apAutoReconnect !== false
  try {
    await wifiWatchdogState.writeConfig({ apAutoReconnect })
  } catch (err) {
    throw new Error(`Cannot save Wi-Fi settings: ${err.message}`)
  }
  return { apAutoReconnect }
}

// Only manual and shared profiles have addresses assigned by configuration
function parseStaticSubnets (stdout) {
  const subnets = []
  for (const rec of nmcli.parseMultiline(stdout, 'connection.id')) {
    const method = (rec['ipv4.method'] || '').trim()
    if (method !== 'manual' && method !== 'shared') continue
    for (const cidr of (rec['ipv4.addresses'] || '').split(',')) {
      const subnet = toSubnet(cidr.trim())
      if (subnet && subnet.ip !== '127.0.0.1') {
        subnets.push({ name: rec['connection.id'], ...subnet })
      }
    }
  }
  return subnets
}

// Static IPv4 subnets configured in NetworkManager profiles
async function getProfileStaticSubnets () {
  const uuids = (await nmcli.run(['-t', '-f', 'UUID', 'connection', 'show'])).split('\n').map(u => u.trim()).filter(Boolean)
  if (uuids.length === 0) return []
  return parseStaticSubnets(await nmcli.run(['-s', '-t', '-f', 'connection.id,ipv4.method,ipv4.addresses', 'connection', 'show', ...uuids]))
}

// Static IPv4 subnets from NetworkManager profiles and Ethernet aliases
async function getStaticIPv4Subnets () {
  const subnets = await getProfileStaticSubnets()
  const aliases = settings.value('ethernet.aliases', [])
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const subnet = alias && toSubnet(alias.ip, alias.subnet || DEFAULT_NETMASK)
    if (subnet) subnets.push({ name: 'Ethernet alias ' + alias.ip, ...subnet })
  }
  return subnets
}

module.exports = {
  setStaticAddressGuard,
  validateAliasList,
  parseStaticSubnets,
  parseConnectionDetails,
  getStaticIPv4Subnets,
  migrateLegacyAliasSettings,
  getAdapters,
  getConnections,
  getConnectionDetails,
  getPrimaryEthernetDevice,
  activateConnection,
  deactivateConnection,
  deleteConnection,
  editConnection,
  addConnection,
  getWirelessStatus,
  setWirelessStatus,
  getWifiScan,
  getEthernetAliases,
  setEthernetAliases,
  resetWifiWatchdogState,
  getWifiSettings,
  setWifiSettings
}
