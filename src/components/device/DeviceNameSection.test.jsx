// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, test, expect, vi, beforeAll, afterEach } from 'vitest'
import DeviceNameSection from './DeviceNameSection.jsx'

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function stubFetch() {
  const fn = vi.fn((url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {}
    const data = url === '/api/system/hostname'
      ? { hostname: body.hostname, sshUser: 'pi', updateApSsid: body.updateApSsid }
      : { hostname: 'rpanion', sshUser: 'pi' }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

async function renderAndRename(newName) {
  const div = document.createElement('div')
  document.body.appendChild(div)
  await act(async () => { createRoot(div).render(<DeviceNameSection token="tok" />) })
  const input = div.querySelector('input')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, newName)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const save = [...div.querySelectorAll('button')].find(b => b.textContent === 'Save')
  await act(async () => { save.click() })
  return div
}

function modalButton(label) {
  return [...document.querySelectorAll('.modal button')].find(b => b.textContent === label)
}

function hostnameRequests(fetchMock) {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/system/hostname').map(([, opts]) => JSON.parse(opts.body))
}

describe('DeviceNameSection', () => {
  test('Save asks before applying; Yes changes the AP SSID too', async () => {
    const fetchMock = stubFetch()
    const div = await renderAndRename('drone-7')
    expect(hostnameRequests(fetchMock)).toEqual([])
    expect(modalButton('Yes').className).toContain('btn-primary')
    expect(modalButton('No').className).toContain('btn-secondary')
    await act(async () => { modalButton('Yes').click() })
    expect(hostnameRequests(fetchMock)).toEqual([{ hostname: 'drone-7', updateApSsid: true }])
    expect(div.textContent).toContain('Device name and access point SSID: drone-7')
  })

  test('No changes only the device name', async () => {
    const fetchMock = stubFetch()
    const div = await renderAndRename('drone-8')
    await act(async () => { modalButton('No').click() })
    expect(hostnameRequests(fetchMock)).toEqual([{ hostname: 'drone-8', updateApSsid: false }])
    expect(div.textContent).toContain('Device name: drone-8')
  })
})
