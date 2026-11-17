// Keyboard behaviour of the terminal as in Linux terminal emulators. Used with
// xterm's attachCustomKeyEventHandler: returning false keeps xterm from handling the key.

function execCopy(doc, text) {
  const area = doc.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  doc.body.appendChild(area);
  area.select();
  try {
    return doc.execCommand('copy');
  } finally {
    doc.body.removeChild(area);
  }
}

// navigator.clipboard exists only in secure contexts (HTTPS, localhost); the UI is usually
// opened over http://<IP>, where execCommand('copy') in the key handler still works.
export function copyText(text, env = {}) {
  const nav = env.navigator ?? globalThis.navigator;
  const doc = env.document ?? globalThis.document;
  const secure = env.isSecureContext ?? globalThis.isSecureContext;
  if (secure && nav?.clipboard?.writeText) {
    nav.clipboard.writeText(text).catch(() => execCopy(doc, text));
    return true;
  }
  return execCopy(doc, text);
}

function isLetter(event, letter) {
  return event.code === `Key${letter.toUpperCase()}` || String(event.key).toLowerCase() === letter;
}

export function createKeyHandler({ term, copy = copyText }) {
  const copySelection = () => {
    if (term.hasSelection()) {
      copy(term.getSelection());
    }
  };

  return (event) => {
    const keydown = event.type === 'keydown';
    const plainModifiers = !event.altKey && !event.metaKey;

    // Ctrl+Shift+C is the element inspector shortcut in Chrome and Firefox
    if (event.ctrlKey && event.shiftKey && plainModifiers && isLetter(event, 'c')) {
      if (keydown) {
        event.preventDefault();
        copySelection();
      }
      return false;
    }

    // No preventDefault: the browser fires its paste event, which xterm pastes
    if (event.ctrlKey && event.shiftKey && plainModifiers && isLetter(event, 'v')) {
      return false;
    }

    // Fallbacks for browsers that keep Ctrl+Shift+C/V
    if (event.key === 'Insert' && plainModifiers) {
      if (event.ctrlKey && !event.shiftKey) {
        if (keydown) {
          event.preventDefault();
          copySelection();
        }
        return false;
      }
      if (event.shiftKey && !event.ctrlKey) {
        return false;
      }
    }

    // Ctrl+C is always SIGINT and Ctrl+V sends ^V, handled by xterm
    return true;
  };
}
