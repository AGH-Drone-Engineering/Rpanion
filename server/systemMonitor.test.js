const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { describe, it, before, after } = require('mocha')
const { SystemMonitor, parseMeminfo } = require('./systemMonitor')

const MEMINFO = [
  'MemTotal:        8000000 kB',
  'MemFree:         1000000 kB',
  'MemAvailable:    6000000 kB',
  'Buffers:          100000 kB',
  'Cached:          4000000 kB'
].join('\n')

describe('SystemMonitor', function () {
  let tmp

  before(function () {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sysmon-'))
    fs.writeFileSync(path.join(tmp, 'cpu_temp'), '58400\n')
    fs.writeFileSync(path.join(tmp, 'meminfo'), MEMINFO)
  })

  after(function () {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const makeMonitor = (extra = {}) => new SystemMonitor({
    cpuTempPath: path.join(tmp, 'cpu_temp'),
    meminfoPath: path.join(tmp, 'meminfo'),
    diskPath: tmp,
    ...extra
  })

  describe('#parseMeminfo()', function () {
    it('computes used memory as MemTotal - MemAvailable', function () {
      const mem = parseMeminfo(MEMINFO)
      assert.equal(mem.total, 8000000 * 1024)
      assert.equal(mem.used, 2000000 * 1024)
      assert.equal(mem.percent, 25)
    })

    it('returns null when fields are missing', function () {
      assert.equal(parseMeminfo('MemTotal: 100 kB'), null)
    })
  })

  describe('#sample()', function () {
    it('reads temperatures, memory and disk usage', function () {
      const s = makeMonitor().sample()
      assert.equal(s.cpuTemp, 58.4)
      assert.equal(s.ramPercent, 25)
      assert.ok(s.diskTotal > 0)
      assert.ok(s.diskPercent >= 0 && s.diskPercent <= 100)
    })

    it('returns null for missing sensors instead of throwing', function () {
      const s = makeMonitor({ cpuTempPath: path.join(tmp, 'missing'), meminfoPath: path.join(tmp, 'missing') }).sample()
      assert.equal(s.cpuTemp, null)
      assert.equal(s.ramPercent, null)
      const hist = makeMonitor({ cpuTempPath: path.join(tmp, 'missing') })
      hist.sample()
      assert.equal(hist.getHistory().samples[0].cpuTemp, null)
    })

    it('calls onSample with each sample', function () {
      const received = []
      makeMonitor({ onSample: (s) => received.push(s) }).sample()
      assert.equal(received.length, 1)
    })
  })

  describe('CPU usage', function () {
    const cpu = (user, idle) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } })
    const feed = (snapshots) => {
      let k = 0
      return () => snapshots[Math.min(k++, snapshots.length - 1)]
    }

    it('computes overall and per-core usage from consecutive snapshots', function () {
      const mon = makeMonitor({
        cpusFn: feed([
          [cpu(100, 900), cpu(100, 900)],
          [cpu(200, 1000), cpu(100, 1100)]
        ])
      })
      const first = mon.sample()
      assert.equal(first.cpuPercent, null)
      assert.equal(first.cpuCores, null)
      const s = mon.sample()
      assert.equal(s.cpuPercent, 25)
      assert.deepEqual(s.cpuCores, [50, 0])
      assert.deepEqual(mon.getHistory().samples.map(h => h.cpuPercent), [null, 25])
      assert.deepEqual(mon.getHistory().samples[1].cpuCores, [50, 0])
    })

    it('restarts the baseline when the core count changes', function () {
      const mon = makeMonitor({
        cpusFn: feed([
          [cpu(0, 0)],
          [cpu(0, 0), cpu(0, 0)],
          [cpu(50, 50), cpu(0, 100)]
        ])
      })
      mon.sample()
      assert.equal(mon.sample().cpuPercent, null)
      assert.equal(mon.sample().cpuPercent, 25)
    })

    it('returns null when CPU times are unavailable', function () {
      const mon = makeMonitor({ cpusFn: () => [] })
      mon.sample()
      const s = mon.sample()
      assert.equal(s.cpuPercent, null)
      assert.equal(s.cpuCores, null)
    })

    it('reports real per-core usage on this host', function () {
      const mon = makeMonitor()
      mon.sample()
      const busyUntil = Date.now() + 50
      while (Date.now() < busyUntil);
      const s = mon.sample()
      assert.equal(s.cpuCores.length, os.cpus().length)
      assert.ok(s.cpuPercent >= 0 && s.cpuPercent <= 100)
    })
  })

  describe('#getHistory()', function () {
    it('keeps only the last `capacity` samples in chronological order', function () {
      const mon = makeMonitor({ capacity: 3 })
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(tmp, 'cpu_temp'), String(50000 + i * 1000))
        mon.sample()
      }
      const hist = mon.getHistory()
      assert.equal(hist.capacity, 3)
      assert.deepEqual(hist.samples.map(s => s.cpuTemp), [52, 53, 54])
      assert.equal(hist.latest.cpuTemp, 54)
      fs.writeFileSync(path.join(tmp, 'cpu_temp'), '58400\n')
    })

    it('returns an empty list before the first sample', function () {
      assert.deepEqual(makeMonitor().getHistory().samples, [])
    })
  })

  describe('#start()/#stop()', function () {
    it('takes a sample immediately and clears the timer on stop', function () {
      const mon = makeMonitor({ intervalMs: 60000 })
      mon.start()
      assert.equal(mon.count, 1)
      assert.ok(mon.timer)
      mon.stop()
      assert.equal(mon.timer, null)
    })
  })
})
