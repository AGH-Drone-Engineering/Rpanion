import { describe, test, expect, vi } from 'vitest'
import { createKeyHandler, copyText } from './terminalKeys.js'

function key(init) {
  return { type: 'keydown', key: '', code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: vi.fn(), ...init }
}

function setup(selection = 'selected text') {
  const term = { hasSelection: () => selection !== '', getSelection: () => selection }
  const copy = vi.fn()
  return { handler: createKeyHandler({ term, copy }), copy }
}

describe('terminal key handler', () => {
  test('Ctrl+C is left to xterm and never copies', () => {
    const { handler, copy } = setup()
    const event = key({ key: 'c', code: 'KeyC', ctrlKey: true })
    expect(handler(event)).toBe(true)
    expect(copy).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  test('Ctrl+V is left to xterm, which sends ^V', () => {
    const { handler } = setup()
    const event = key({ key: 'v', code: 'KeyV', ctrlKey: true })
    expect(handler(event)).toBe(true)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  test('Ctrl+Shift+C copies the selection and blocks the browser shortcut', () => {
    const { handler, copy } = setup()
    const event = key({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })
    expect(handler(event)).toBe(false)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(copy).toHaveBeenCalledWith('selected text')
  })

  test('Ctrl+Shift+C without a selection copies nothing but is still swallowed', () => {
    const { handler, copy } = setup('')
    const event = key({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })
    expect(handler(event)).toBe(false)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(copy).not.toHaveBeenCalled()
  })

  test('Ctrl+Shift+C copies once: keyup and keypress are swallowed without copying', () => {
    const { handler, copy } = setup()
    for (const type of ['keypress', 'keyup']) {
      expect(handler(key({ type, key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true }))).toBe(false)
    }
    expect(copy).not.toHaveBeenCalled()
  })

  test('Ctrl+Shift+V is not sent as ^V and keeps the browser paste event', () => {
    const { handler } = setup()
    const event = key({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true })
    expect(handler(event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  test('Ctrl+Insert copies and Shift+Insert pastes', () => {
    const { handler, copy } = setup()
    const copyEvent = key({ key: 'Insert', code: 'Insert', ctrlKey: true })
    expect(handler(copyEvent)).toBe(false)
    expect(copy).toHaveBeenCalledWith('selected text')
    const pasteEvent = key({ key: 'Insert', code: 'Insert', shiftKey: true })
    expect(handler(pasteEvent)).toBe(false)
    expect(pasteEvent.preventDefault).not.toHaveBeenCalled()
  })

  test('other keys and Alt/Meta combinations pass through', () => {
    const { handler, copy } = setup()
    expect(handler(key({ key: 'a', code: 'KeyA' }))).toBe(true)
    expect(handler(key({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true, altKey: true }))).toBe(true)
    expect(handler(key({ key: 'c', code: 'KeyC', metaKey: true }))).toBe(true)
    expect(copy).not.toHaveBeenCalled()
  })
})

describe('copyText', () => {
  function fakeDoc(result = true) {
    const area = { style: {}, select: vi.fn() }
    return {
      area,
      createElement: vi.fn(() => area),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand: vi.fn(() => result)
    }
  }

  test('uses execCommand outside a secure context', () => {
    const document = fakeDoc()
    const writeText = vi.fn()
    expect(copyText('abc', { document, navigator: { clipboard: { writeText } }, isSecureContext: false })).toBe(true)
    expect(document.area.value).toBe('abc')
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(document.body.removeChild).toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })

  test('uses the async clipboard API in a secure context', () => {
    const document = fakeDoc()
    const writeText = vi.fn(() => Promise.resolve())
    copyText('abc', { document, navigator: { clipboard: { writeText } }, isSecureContext: true })
    expect(writeText).toHaveBeenCalledWith('abc')
    expect(document.execCommand).not.toHaveBeenCalled()
  })
})
