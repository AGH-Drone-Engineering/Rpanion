// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

const fakes = vi.hoisted(() => ({ terminals: [], sockets: [] }))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor () {
      this.cols = 80
      this.rows = 24
      this.written = []
      this.handlers = {}
      this.resets = 0
      fakes.terminals.push(this)
    }
    loadAddon () {}
    open () {}
    focus () {}
    dispose () {}
    reset () { this.resets++ }
    attachCustomKeyEventHandler (fn) { this.keyHandler = fn }
    attachCustomWheelEventHandler (fn) { this.wheelHandler = fn }
    onData (fn) { this.handlers.data = fn }
    onResize (fn) { this.handlers.resize = fn }
    write (data, cb) { this.written.push(data); if (cb) cb() }
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit () {} } }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('socket.io-client', () => ({
  io: (url, options) => {
    const handlers = {}
    const socket = {
      url,
      options,
      emitted: [],
      on: (event, fn) => { handlers[event] = fn },
      emit: (event, payload) => socket.emitted.push([event, payload]),
      disconnect: vi.fn(),
      fire: (event, payload) => handlers[event](payload)
    }
    fakes.sockets.push(socket)
    return socket
  }
}))

import TerminalSession from './components/terminal/TerminalSession.jsx'

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

const STATUS = {
  installed: true,
  activeState: 'active',
  memory: { controller: true, anonBytes: 512 * 1048576, maxBytes: null, totalBytes: 4096 * 1048576, oomKills: 1 },
  cpu: { usageUsec: 1000000, cores: 4 },
  sampledAt: 1000
}

let status
let fetchMock

beforeEach(() => {
  fakes.terminals.length = 0
  fakes.sockets.length = 0
  status = { ...STATUS }
  fetchMock = vi.fn((url, opts = {}) => {
    const data = url === '/api/terminal/stop' ? { stopping: true } : status
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function render () {
  const div = document.createElement('div')
  document.body.appendChild(div)
  await act(async () => { createRoot(div).render(<TerminalSession token="tok" />) })
  return div
}

const button = (label) => [...document.querySelectorAll('button')].find(b => b.textContent === label)
const attaches = (socket) => socket.emitted.filter(([event]) => event === 'attach').map(([, payload]) => payload)

describe('TerminalSession', () => {
  test('connects with the bearer token and attaches without starting', async () => {
    await render()
    const socket = fakes.sockets[0]
    expect(socket.url).toBe('/terminal')
    expect(socket.options.extraHeaders.authorization).toBe('Bearer tok')
    await act(async () => { socket.fire('connect') })
    expect(attaches(socket)).toEqual([{ cols: 80, rows: 24, start: false }])
  })

  test('shows Start session when nothing runs and starts only on the click', async () => {
    const div = await render()
    const socket = fakes.sockets[0]
    await act(async () => { socket.fire('connect') })
    await act(async () => { socket.fire('state', { state: 'inactive' }) })
    expect(div.textContent).not.toContain('Connecting')
    await act(async () => { button('Start session').click() })
    expect(attaches(socket)).toEqual([
      { cols: 80, rows: 24, start: false },
      { cols: 80, rows: 24, start: true }
    ])
  })

  test('relays terminal output with acknowledgements and input and resize events', async () => {
    await render()
    const socket = fakes.sockets[0]
    const term = fakes.terminals[0]
    await act(async () => { socket.fire('state', { state: 'attached' }) })
    expect(term.resets).toBe(1)
    await act(async () => { socket.fire('output', new Uint8Array([104, 105]).buffer) })
    expect(Array.from(term.written[0])).toEqual([104, 105])
    expect(socket.emitted).toContainEqual(['ack', 2])
    term.handlers.data('ls\r')
    term.handlers.resize({ cols: 100, rows: 30 })
    expect(socket.emitted).toContainEqual(['input', 'ls\r'])
    expect(socket.emitted).toContainEqual(['resize', { cols: 100, rows: 30 }])
  })

  test('sends the mouse wheel to tmux as scroll keys', async () => {
    await render()
    const socket = fakes.sockets[0]
    await act(async () => { socket.fire('state', { state: 'attached' }) })
    const term = fakes.terminals.at(-1)
    expect(term.wheelHandler({ deltaMode: 1, deltaY: -3, preventDefault () {} })).toBe(false)
    expect(socket.emitted.filter(([name]) => name === 'input').at(-1)).toEqual(['input', '\x1b[42001~'])
  })

  test('Stop session asks for confirmation, then shows Stopping and Session stopped', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const div = await render()
      const socket = fakes.sockets[0]
      await act(async () => { socket.fire('state', { state: 'attached' }) })
      await act(async () => { button('Stop session').click() })
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/terminal/stop')).toBe(false)
      const confirm = [...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Stop session')
      await act(async () => { confirm.click() })
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/terminal/stop')).toHaveLength(1)
      expect(div.textContent).toContain('Stopping...')

      status = { ...STATUS, activeState: 'deactivating' }
      await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
      expect(div.textContent).toContain('Stopping...')

      status = { ...STATUS, activeState: 'inactive' }
      await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
      expect(div.textContent).toContain('Session stopped')
      expect(button('New session')).toBeTruthy()

      // A reconnect must not start a new session
      await act(async () => { socket.fire('connect') })
      expect(attaches(socket)).toHaveLength(0)

      await act(async () => { button('New session').click() })
      expect(attaches(socket)).toEqual([{ cols: 80, rows: 24, start: true }])
    } finally {
      vi.useRealTimers()
    }
  })

  test('the end of the tmux client shows Session stopped', async () => {
    const div = await render()
    const socket = fakes.sockets[0]
    await act(async () => { socket.fire('state', { state: 'attached' }) })
    status = { ...STATUS, activeState: 'inactive' }
    await act(async () => { socket.fire('exit', { code: 0 }) })
    expect(div.textContent).toContain('Session stopped')
  })

  test('shows connection errors from the server', async () => {
    const div = await render()
    await act(async () => { fakes.sockets[0].fire('connect_error', new Error('Terminal requires authentication to be enabled')) })
    expect(div.textContent).toContain('Terminal requires authentication to be enabled')
  })

  test('shows memory use against total RAM, OOM kills, and no reserve controls', async () => {
    const div = await render()
    await act(async () => {})
    expect(div.textContent).toContain('Memory: 512 MB of 4096 MB')
    expect(div.textContent).toContain('Killed when out of memory: 1')
    expect(div.querySelector('input[type=range]')).toBe(null)
    expect(div.querySelectorAll('.progress-bar')).toHaveLength(2)
  })

  test('memory is shown as unavailable without the memory controller', async () => {
    status = { ...STATUS, memory: { controller: false, anonBytes: null, maxBytes: null, totalBytes: 4096 * 1048576, oomKills: null } }
    const div = await render()
    await act(async () => {})
    expect(div.textContent).toContain('Memory: unavailable')
  })

  describe('tabs', () => {
    const win = (n, active = false) => ({ id: `@${n}`, index: n, name: n === 1 ? 'htop' : 'bash', active })
    const tabs = (div) => [...div.querySelectorAll('[role=tab]')]
    const emitted = (socket, event) => socket.emitted.filter(([name]) => name === event).map(([, payload]) => payload)

    // Lets the modal fade-out finish before the next test clears the document
    const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })

    async function attachedWith (windows) {
      const div = await render()
      const socket = fakes.sockets[0]
      await act(async () => { socket.fire('state', { state: 'attached' }) })
      if (windows) await act(async () => { socket.fire('windows', windows) })
      return { div, socket }
    }

    test('shows no tab bar before the window list arrives or while not attached', async () => {
      const div = await render()
      const socket = fakes.sockets[0]
      await act(async () => { socket.fire('windows', [win(0, true)]) })
      expect(tabs(div)).toHaveLength(0)
      await act(async () => { socket.fire('state', { state: 'attached' }) })
      expect(tabs(div)).toHaveLength(1)
    })

    test('lists the windows and marks the active one', async () => {
      const { div } = await attachedWith([win(0), win(1, true)])
      expect(tabs(div).map(t => t.textContent.replace('\u00d7', ''))).toEqual(['1 bash', '2 htop'])
      expect(tabs(div).map(t => t.getAttribute('aria-selected'))).toEqual(['false', 'true'])
      expect(tabs(div)[1].className).toContain('active')
    })

    test('switches tabs and opens a new one', async () => {
      const { div, socket } = await attachedWith([win(0, true), win(1)])
      await act(async () => { tabs(div)[1].click() })
      expect(emitted(socket, 'window-select')).toEqual(['@1'])
      await act(async () => { div.querySelector('[aria-label="New tab"]').click() })
      expect(emitted(socket, 'window-new')).toHaveLength(1)
    })

    test('closing a tab needs confirmation and does not switch to it', async () => {
      const { div, socket } = await attachedWith([win(0, true), win(1)])
      await act(async () => { div.querySelector('[aria-label="Close tab 2"]').click() })
      expect(emitted(socket, 'window-close')).toEqual([])
      expect(emitted(socket, 'window-select')).toEqual([])
      const cancel = [...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Cancel')
      await act(async () => { cancel.click() })
      await settle()
      expect(emitted(socket, 'window-close')).toEqual([])
      await act(async () => { div.querySelector('[aria-label="Close tab 2"]').click() })
      const confirm = [...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Close tab')
      await act(async () => { confirm.click() })
      await settle()
      expect(emitted(socket, 'window-close')).toEqual(['@1'])
    })

    test('hides the close button on the last tab', async () => {
      const { div } = await attachedWith([win(0, true)])
      expect(div.querySelector('[aria-label^="Close tab"]')).toBe(null)
    })

    test('disables the new tab button at the limit', async () => {
      const windows = Array.from({ length: 8 }, (_, i) => win(i, i === 0))
      const { div } = await attachedWith(windows)
      expect(div.querySelector('[aria-label="New tab"]').disabled).toBe(true)
      await act(async () => { fakes.sockets[0].fire('windows', windows.slice(0, 7)) })
      expect(div.querySelector('[aria-label="New tab"]').disabled).toBe(false)
    })

    test('shows window errors from the server', async () => {
      const { div, socket } = await attachedWith([win(0, true)])
      await act(async () => { socket.fire('window-error', { message: 'At most 8 tabs' }) })
      expect(div.textContent).toContain('At most 8 tabs')
    })

    test('removes the tab bar when the session ends', async () => {
      const { div, socket } = await attachedWith([win(0, true), win(1)])
      status = { ...STATUS, activeState: 'inactive' }
      await act(async () => { socket.fire('exit', { code: 0 }) })
      expect(tabs(div)).toHaveLength(0)
    })
  })
})
