const fs = require('fs')

const DEFAULT_INTERVAL_MS = 2000
// 5 min of history at the default interval
const DEFAULT_CAPACITY = 150

const DEFAULTS = {
  cpuTempPath: '/sys/class/thermal/thermal_zone0/temp',
  meminfoPath: '/proc/meminfo',
  diskPath: '/'
}

// sysfs temperatures are in millidegrees Celsius
function readMilliCelsius (filePath) {
  if (!filePath) return null
  try {
    const value = parseInt(fs.readFileSync(filePath, 'utf8'), 10)
    return Number.isFinite(value) ? value / 1000 : null
  } catch {
    return null
  }
}

// Used memory excludes reclaimable page cache (MemTotal - MemAvailable), matching `free`
function parseMeminfo (text) {
  const kb = (key) => {
    const match = text.match(new RegExp('^' + key + ':\\s+(\\d+)\\s+kB', 'm'))
    return match ? parseInt(match[1], 10) * 1024 : null
  }
  const total = kb('MemTotal')
  const available = kb('MemAvailable')
  if (!total || available === null) return null
  const used = total - available
  return { used, total, percent: (used / total) * 100 }
}

function readMemory (meminfoPath) {
  try {
    return parseMeminfo(fs.readFileSync(meminfoPath, 'utf8'))
  } catch {
    return null
  }
}

// Percent is computed like `df`: used / (used + available to non-root)
function readDisk (diskPath) {
  try {
    const st = fs.statfsSync(diskPath)
    const total = st.blocks * st.bsize
    const used = (st.blocks - st.bfree) * st.bsize
    const usable = used + st.bavail * st.bsize
    return { used, total, percent: usable > 0 ? (used / usable) * 100 : 0 }
  } catch {
    return null
  }
}

class SystemMonitor {
  constructor (options = {}) {
    this.opts = { ...DEFAULTS, ...options }
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS
    this.capacity = options.capacity || DEFAULT_CAPACITY
    this.onSample = options.onSample || null

    // Fixed-size ring buffer; NaN marks a missing reading
    this.t = new Float64Array(this.capacity)
    this.cpuTemp = new Float32Array(this.capacity)
    this.ramPercent = new Float32Array(this.capacity)
    this.diskPercent = new Float32Array(this.capacity)
    this.head = 0
    this.count = 0
    this.latest = null
    this.timer = null
  }

  sample () {
    const mem = readMemory(this.opts.meminfoPath)
    const disk = readDisk(this.opts.diskPath)
    const s = {
      t: Date.now(),
      cpuTemp: readMilliCelsius(this.opts.cpuTempPath),
      ramPercent: mem ? mem.percent : null,
      ramUsed: mem ? mem.used : null,
      ramTotal: mem ? mem.total : null,
      diskPercent: disk ? disk.percent : null,
      diskUsed: disk ? disk.used : null,
      diskTotal: disk ? disk.total : null
    }

    const i = this.head
    this.t[i] = s.t
    this.cpuTemp[i] = s.cpuTemp ?? NaN
    this.ramPercent[i] = s.ramPercent ?? NaN
    this.diskPercent[i] = s.diskPercent ?? NaN
    this.head = (i + 1) % this.capacity
    this.count = Math.min(this.count + 1, this.capacity)
    this.latest = s

    if (this.onSample) this.onSample(s)
    return s
  }

  // Chronological history as plain arrays (null for missing readings)
  getHistory () {
    const toVal = (v) => (Number.isNaN(v) ? null : Math.round(v * 10) / 10)
    const start = (this.head - this.count + this.capacity) % this.capacity
    const samples = []
    for (let k = 0; k < this.count; k++) {
      const i = (start + k) % this.capacity
      samples.push({
        t: this.t[i],
        cpuTemp: toVal(this.cpuTemp[i]),
        ramPercent: toVal(this.ramPercent[i]),
        diskPercent: toVal(this.diskPercent[i])
      })
    }
    return {
      intervalMs: this.intervalMs,
      capacity: this.capacity,
      latest: this.latest,
      samples
    }
  }

  start () {
    if (this.timer) return
    this.sample()
    this.timer = setInterval(() => this.sample(), this.intervalMs)
    // do not keep the process alive for monitoring alone
    this.timer.unref()
  }

  stop () {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

module.exports = { SystemMonitor, parseMeminfo, DEFAULT_CAPACITY, DEFAULT_INTERVAL_MS }
