import { describe, test, expect, vi, afterEach } from 'vitest'
import { createTerminalApi } from './terminalApi.js'

function mockFetch(status, body) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createTerminalApi', () => {
  test('getStatus and stop use the bearer token', async () => {
    const fetchMock = mockFetch(200, { activeState: 'active' })
    expect(await createTerminalApi('tok').getStatus()).toEqual({ activeState: 'active' })
    await createTerminalApi('tok').stop()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/terminal/status')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/terminal/stop')
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
  })
})
