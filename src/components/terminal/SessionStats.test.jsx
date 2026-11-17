// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, test, expect, beforeAll, afterEach } from 'vitest'
import SessionStats, { cpuTotalPercent } from './SessionStats.jsx'

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  document.body.innerHTML = ''
})

const MB = 1024 * 1024

function status ({ controller = true, anonMb = 512, maxMb = null, totalMb = 2048, usageUsec = 0, sampledAt = 0, oomKills = 0 } = {}) {
  return {
    memory: {
      controller,
      anonBytes: controller ? anonMb * MB : null,
      maxBytes: maxMb === null ? null : maxMb * MB,
      totalBytes: totalMb * MB,
      oomKills
    },
    cpu: { usageUsec, cores: 4 },
    sampledAt
  }
}

function render (props) {
  const div = document.createElement('div')
  document.body.appendChild(div)
  const root = createRoot(div)
  act(() => root.render(<SessionStats {...props} />))
  return { div, root }
}

describe('cpuTotalPercent', () => {
  test('converts percent of one core to a share of all cores', () => {
    expect(cpuTotalPercent(200, 4)).toBe(50)
    expect(cpuTotalPercent(400, 4)).toBe(100)
  })

  test('caps at 100 and handles missing data', () => {
    expect(cpuTotalPercent(900, 4)).toBe(100)
    expect(cpuTotalPercent(null, 4)).toBe(null)
    expect(cpuTotalPercent(50, 0)).toBe(null)
  })
})

describe('SessionStats', () => {
  test('shows memory against total RAM and CPU as bars', () => {
    const { div, root } = render({ status: status() })
    // Second sample: 2 s of 4 cores fully used = 8 000 000 us
    act(() => root.render(<SessionStats status={status({ usageUsec: 8000000, sampledAt: 2000 })} />))

    const bars = div.querySelectorAll('.progress-bar')
    expect(bars).toHaveLength(2)
    expect(bars[0].getAttribute('aria-valuenow')).toBe('25')
    expect(bars[1].getAttribute('aria-valuenow')).toBe('100')
    expect(div.textContent).toContain('512 MB of 2048 MB')
    expect(div.textContent).toContain('100% of 4 cores')
    expect(div.textContent).toContain('Killed when out of memory: 0')
    expect(div.querySelector('input[type="range"]')).toBe(null)
    expect(div.querySelectorAll('[aria-label="Help"]')).toHaveLength(1)
  })

  test('uses memory.max when a limit is set', () => {
    const { div } = render({ status: status({ maxMb: 1024 }) })
    expect(div.textContent).toContain('512 MB of 1024 MB')
    expect(div.querySelector('.progress-bar').getAttribute('aria-valuenow')).toBe('50')
  })

  test('shows memory as unavailable without the memory controller', () => {
    const { div } = render({ status: status({ controller: false }) })
    expect(div.textContent).toContain('Memory: unavailable')
  })
})
