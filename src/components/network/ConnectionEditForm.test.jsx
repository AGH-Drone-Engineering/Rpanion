// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, test, expect, vi, beforeAll } from 'vitest'
import ConnectionEditForm from './ConnectionEditForm.jsx'

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

const conA = { value: 'aaaa', labelPre: 'A', type: '802-11-wireless', state: '', role: null }
const conB = { value: 'bbbb', labelPre: 'B', type: '802-11-wireless', state: '', role: null }

describe('ConnectionEditForm', () => {
  test('ignores a late details reply for a previously selected profile', async () => {
    const replies = { aaaa: deferred(), bbbb: deferred() }
    const api = { getConnectionDetails: vi.fn(uuid => replies[uuid].promise) }
    const onSave = vi.fn()
    const div = document.createElement('div')
    document.body.appendChild(div)
    const root = createRoot(div)
    const props = { api, device: { value: 'wlan0', type: 'wifi' }, reloadSeq: 1, onSave, onError: vi.fn() }

    await act(async () => { root.render(<ConnectionEditForm {...props} connection={conA} />) })
    await act(async () => { root.render(<ConnectionEditForm {...props} connection={conB} />) })
    await act(async () => { replies.bbbb.resolve({ DHCP: 'auto', ssid: 'net-b', mode: 'infrastructure', wpaType: 'none', priority: 5 }) })
    await act(async () => { replies.aaaa.resolve({ DHCP: 'manual', IP: '1.2.3.4', ssid: 'net-a', mode: 'infrastructure', priority: 9 }) })

    expect(div.querySelector('#con-edit-ssid').value).toBe('net-b')
    await act(async () => { div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toBe('bbbb')
    expect(onSave.mock.calls[0][1]).toMatchObject({ ssid: 'net-b', priority: 5 })

    act(() => root.unmount())
    div.remove()
  })

  test('does not save before the selected profile has loaded', async () => {
    const pending = deferred()
    const api = { getConnectionDetails: vi.fn(() => pending.promise) }
    const onSave = vi.fn()
    const div = document.createElement('div')
    const root = createRoot(div)
    await act(async () => {
      root.render(<ConnectionEditForm api={api} connection={conA} reloadSeq={1} onSave={onSave} onError={vi.fn()} />)
    })
    await act(async () => { div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(onSave).not.toHaveBeenCalled()
    act(() => root.unmount())
  })
})
