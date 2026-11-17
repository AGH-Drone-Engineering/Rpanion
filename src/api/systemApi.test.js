import { describe, test, expect, vi, afterEach } from 'vitest'
import { createSystemApi } from './systemApi.js'

function mockFetch(status, body) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSystemApi', () => {
  test('getIdentity sends the bearer token', async () => {
    const fetchMock = mockFetch(200, { hostname: 'rpanion', sshUser: 'pi' })
    const res = await createSystemApi('tok').getIdentity()
    expect(res).toEqual({ hostname: 'rpanion', sshUser: 'pi' })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/system/identity')
    expect(opts.headers.Authorization).toBe('Bearer tok')
  })

  test('setHostname posts the name', async () => {
    const fetchMock = mockFetch(200, { hostname: 'rpanion-07', infoMessage: 'Device name updated' })
    await createSystemApi('tok').setHostname('rpanion-07')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/system/hostname')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ hostname: 'rpanion-07' })
  })

  test('throws the server message on an error status', async () => {
    mockFetch(422, { error: 'Device name must be 1-63 characters' })
    await expect(createSystemApi('tok').setHostname('Bad_Name')).rejects.toThrow('Device name must be 1-63 characters')
  })
})
