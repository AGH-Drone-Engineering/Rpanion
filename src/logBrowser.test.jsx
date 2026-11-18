// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

const fakes = vi.hoisted(() => ({ sockets: [] }))

vi.mock('socket.io-client', () => ({
  default: () => {
    const handlers = {}
    const socket = {
      on: (event, fn) => { handlers[event] = fn },
      disconnect: vi.fn(),
      fire: (event, payload) => handlers[event](payload)
    }
    fakes.sockets.push(socket)
    return socket
  }
}))

import LoggerPage from './logBrowser.jsx'

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

const media = [
  { key: 'RPN1.jpg', name: 'RPN1.jpg', size: 10, modified: '2026-01-01T10:00:00Z' },
  { key: 'RPN2.avi', name: 'RPN2.avi', size: 10, modified: '2026-01-01T11:00:00Z' },
  { key: 'RPN3.jpg', name: 'RPN3.jpg', size: 10, modified: '2026-01-01T12:00:00Z' },
  { key: 'RPN4.png', name: 'RPN4.png', size: 10, modified: '2026-01-01T13:00:00Z' }
]

let fetchMock
let root

function stubFetch () {
  fetchMock = vi.fn((url) => {
    const bodies = {
      '/api/logfiles': { TlogFiles: [], BinlogFiles: [], KMZlogFiles: [], MediaFiles: media },
      '/api/terminal/logs': { enabled: true, files: [] },
      '/api/diskinfo': { diskSpaceStatus: '1 GB' },
      '/api/logconversioninfo': { conversionLogStatus: 'N/A', doLogConversion: false }
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(bodies[url] || {}) })
  })
  vi.stubGlobal('fetch', fetchMock)
}

const count = (url) => fetchMock.mock.calls.filter(([u]) => u === url).length

async function renderPage () {
  const div = document.createElement('div')
  document.body.appendChild(div)
  root = createRoot(div)
  await act(async () => { root.render(<LoggerPage />) })
  await act(async () => {})
  return div
}

async function advance (ms) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

beforeEach(() => {
  fakes.sockets.length = 0
  vi.useFakeTimers()
  stubFetch()
})

afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('LoggerPage live lists', () => {
  test('a media event refetches the file list once after the debounce', async () => {
    await renderPage()
    const socket = fakes.sockets[0]
    const before = count('/api/logfiles')
    const terminalBefore = count('/api/terminal/logs')
    act(() => {
      socket.fire('logs:changed', { type: 'media' })
      socket.fire('logs:changed', { type: 'media' })
    })
    await advance(300)
    expect(count('/api/logfiles')).toBe(before)
    await advance(300)
    expect(count('/api/logfiles')).toBe(before + 1)
    expect(count('/api/terminal/logs')).toBe(terminalBefore)
  })

  test('a terminal event refetches only the terminal logs', async () => {
    await renderPage()
    const before = count('/api/logfiles')
    const terminalBefore = count('/api/terminal/logs')
    act(() => fakes.sockets[0].fire('logs:changed', { type: 'terminal' }))
    await advance(600)
    expect(count('/api/logfiles')).toBe(before)
    expect(count('/api/terminal/logs')).toBe(terminalBefore + 1)
  })

  test('mixed events refetch each endpoint once', async () => {
    await renderPage()
    const before = count('/api/logfiles')
    const terminalBefore = count('/api/terminal/logs')
    act(() => {
      fakes.sockets[0].fire('logs:changed', { type: 'telemetry' })
      fakes.sockets[0].fire('logs:changed', { type: 'bin' })
      fakes.sockets[0].fire('logs:changed', { type: 'terminal' })
    })
    await advance(600)
    expect(count('/api/logfiles')).toBe(before + 1)
    expect(count('/api/terminal/logs')).toBe(terminalBefore + 1)
  })

  test('expanding a section refetches its list', async () => {
    const div = await renderPage()
    const headers = div.querySelectorAll('.accordion-button')
    const before = count('/api/logfiles')
    const terminalBefore = count('/api/terminal/logs')
    await act(async () => { headers[1].click() })
    expect(count('/api/logfiles')).toBe(before + 1)
    await act(async () => { headers[3].click() })
    expect(count('/api/terminal/logs')).toBe(terminalBefore + 1)
    expect(count('/api/logfiles')).toBe(before + 1)
  })
})

describe('LoggerPage photo viewer', () => {
  const viewerImage = () => document.getElementById('mediaViewerImage')

  async function open (div, name) {
    const link = [...div.querySelectorAll('#Mediafile ~ div a, a')].find(a => a.textContent === name)
    await act(async () => { link.click() })
  }

  test('lists media newest first and opens an image without loading others', async () => {
    const div = await renderPage()
    const names = [...div.querySelectorAll('a[download]')].map(a => a.textContent)
    expect(names).toEqual(['RPN4.png', 'RPN3.jpg', 'RPN2.avi', 'RPN1.jpg'])
    expect(viewerImage()).toBeNull()
    await open(div, 'RPN3.jpg')
    expect(viewerImage().getAttribute('src')).toBe('/media/RPN3.jpg')
    expect(document.querySelectorAll('img').length).toBe(1)
    expect(document.getElementById('mediaViewerDownload').getAttribute('href')).toBe('/media/RPN3.jpg')
  })

  test('a video link is not opened in the viewer', async () => {
    const div = await renderPage()
    await open(div, 'RPN2.avi')
    expect(viewerImage()).toBeNull()
  })

  test('previous and next buttons follow the table order and skip videos', async () => {
    const div = await renderPage()
    await open(div, 'RPN3.jpg')
    await act(async () => { document.getElementById('mediaViewerNext').click() })
    expect(viewerImage().getAttribute('src')).toBe('/media/RPN1.jpg')
    expect(document.getElementById('mediaViewerNext').disabled).toBe(true)
    await act(async () => { document.getElementById('mediaViewerPrev').click() })
    await act(async () => { document.getElementById('mediaViewerPrev').click() })
    expect(viewerImage().getAttribute('src')).toBe('/media/RPN4.png')
    expect(document.getElementById('mediaViewerPrev').disabled).toBe(true)
  })

  test('arrow keys navigate and Escape closes', async () => {
    const div = await renderPage()
    await open(div, 'RPN3.jpg')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(viewerImage().getAttribute('src')).toBe('/media/RPN1.jpg')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
    expect(viewerImage().getAttribute('src')).toBe('/media/RPN3.jpg')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await advance(500)
    expect(viewerImage()).toBeNull()
  })
})
