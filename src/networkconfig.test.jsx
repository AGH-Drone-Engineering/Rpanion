// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, test, expect, vi, beforeAll, afterEach } from 'vitest'
import NetworkConfig from './networkconfig.jsx'

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const responses = {
  '/api/networkadapters': { netDevice: [
    { value: 'eth0', label: 'eth0 (ethernet)', type: 'ethernet' },
    { value: 'wlan0', label: 'wlan0 (wifi)', type: 'wifi', channels: [] }
  ] },
  '/api/networkconnections': { netConnection: [
    { value: 'srv', labelPre: 'Ethernet-Server', type: '802-3-ethernet', state: '', attachedIface: '', role: 'ethernet-server' },
    { value: 'cli', labelPre: 'Ethernet-Client', type: '802-3-ethernet', state: 'eth0', attachedIface: '', role: 'ethernet-client' },
    { value: 'wired', labelPre: 'Lab Wired', type: '802-3-ethernet', state: '', attachedIface: 'eth0', role: null },
    { value: 'ap', labelPre: 'WiFiAP', type: '802-11-wireless', state: 'wlan0', attachedIface: '', role: 'wifi-ap' }
  ] },
  '/api/wirelessstatus': { wirelessEnabled: true },
  '/api/wifisettings': { apAutoReconnect: true },
  '/api/ethernetaliases': [],
  '/api/networkIP': { netConnectionDetails: { DHCP: 'shared', IP: '10.0.2.100', subnet: '255.255.255.0', mode: 'ap', band: 'bg', priority: 0 } },
  '/api/auth': {}
}

function stubFetch() {
  const fn = vi.fn((url) => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(responses[url])
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

async function renderPage() {
  const div = document.createElement('div')
  document.body.appendChild(div)
  const root = createRoot(div)
  await act(async () => { root.render(<NetworkConfig />) })
  await act(async () => {})
  return { div, root }
}

describe('NetworkConfig', () => {
  test('mount reads each endpoint once and selects the Wi-Fi adapter', async () => {
    const fetchMock = stubFetch()
    const { div, root } = await renderPage()
    const counts = {}
    fetchMock.mock.calls.forEach(([url]) => { counts[url] = (counts[url] || 0) + 1 })
    expect(counts['/api/networkconnections']).toBe(1)
    expect(counts['/api/networkadapters']).toBe(1)
    expect(counts['/api/networkIP']).toBe(1)
    expect(div.querySelector('#adapter-select').value).toBe('wlan0')
    // WiFiAP is a system profile: delete stays disabled
    expect(div.querySelector('.deleteConnection').disabled).toBe(true)
    expect(div.querySelector('.deactivateConnection').disabled).toBe(true)
    act(() => root.unmount())
    div.remove()
  })

  test('ethernet adapter lists unassigned wired profiles under Other profiles', async () => {
    stubFetch()
    const { div, root } = await renderPage()
    const adapter = div.querySelector('#adapter-select')
    await act(async () => {
      adapter.value = 'eth0'
      adapter.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const select = div.querySelector('#eth-connection-select')
    expect(select.value).toBe('client')
    const group = select.querySelector('optgroup[label="Other profiles"]')
    expect(group).not.toBeNull()
    expect(group.querySelector('option').value).toBe('wired')

    await act(async () => {
      select.value = 'wired'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {})
    expect(div.querySelector('.deleteConnection').disabled).toBe(false)
    expect(div.querySelector('.activateConnection')).not.toBeNull()
    act(() => root.unmount())
    div.remove()
  })
})
