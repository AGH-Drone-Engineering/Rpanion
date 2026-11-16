import { describe, test, expect, vi, afterEach } from 'vitest'
import { createNetworkApi } from './networkApi.js'

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

describe('createNetworkApi', () => {
  test('sends auth headers and unwraps the payload', async () => {
    const fetchMock = mockFetch(200, { netDevice: [{ value: 'eth0' }] })
    const res = await createNetworkApi('tok').getAdapters()
    expect(res).toEqual([{ value: 'eth0' }])
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/networkadapters')
    expect(opts.headers.Authorization).toBe('Bearer tok')
    expect(opts.headers.Accept).toBe('application/json')
  })

  test('throws the server message on an error status', async () => {
    mockFetch(409, { error: 'Cannot delete system profile', message: 'Cannot delete system profile' })
    await expect(createNetworkApi('t').remove('u')).rejects.toThrow('Cannot delete system profile')
  })

  test('throws when a 200 body carries an error', async () => {
    mockFetch(200, { error: 'nmcli failed' })
    await expect(createNetworkApi('t').activate('u')).rejects.toThrow('nmcli failed')
  })

  test('falls back to the status code when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.reject(new Error('x')) }))
    await expect(createNetworkApi('t').getConnections()).rejects.toThrow('Request failed (500)')
  })

  test('drops empty strings from request bodies', async () => {
    const fetchMock = mockFetch(200, { error: null })
    await createNetworkApi('t').edit('u', { ipaddresstype: 'auto', ipaddress: '', priority: 5 })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ conName: 'u', conSettings: { ipaddresstype: 'auto', priority: 5 } })
  })
})
