import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';
import { io } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { createTerminalApi } from '../../api/terminalApi.js';
import { createKeyHandler } from '../../terminalKeys.js';
import SessionStats from './SessionStats.jsx';
import TerminalTabs from './TerminalTabs.jsx';

const STATUS_POLL_MS = 2000;

// connecting | inactive (not started yet) | attached | stopping | stopped | unavailable
function TerminalSession({ token }) {
  const api = useMemo(() => createTerminalApi(token), [token]);
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const socketRef = useRef(null);
  // Reconnects attach again only while a session is wanted; after "Session stopped" they must not
  const wantAttach = useRef(true);
  const stateRef = useRef('connecting');
  const [state, setStateValue] = useState('connecting');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState(null);
  const [windows, setWindows] = useState([]);
  const [confirmStop, setConfirmStop] = useState(false);
  const [error, setError] = useState(null);

  const setState = useCallback((value, text = '') => {
    stateRef.current = value;
    setStateValue(value);
    setMessage(text);
  }, []);

  const attach = useCallback((start) => {
    const term = termRef.current;
    if (!socketRef.current || !term) return;
    wantAttach.current = true;
    socketRef.current.emit('attach', { cols: term.cols, rows: term.rows, start });
  }, []);

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, fontFamily: 'monospace', scrollback: 0 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    term.attachCustomKeyEventHandler(createKeyHandler({ term }));
    termRef.current = term;
    fitRef.current = fit;

    const socket = io('/terminal', {
      forceNew: true,
      extraHeaders: { authorization: `Bearer ${token}` }
    });
    socketRef.current = socket;

    term.onData((data) => socket.emit('input', data));
    term.onResize(({ cols, rows }) => socket.emit('resize', { cols, rows }));

    socket.on('connect', () => {
      if (wantAttach.current) attach(false);
    });
    socket.on('connect_error', (err) => setState('unavailable', err.message));
    socket.on('disconnect', () => {
      setWindows([]);
      if (stateRef.current === 'attached') setState('connecting');
    });
    socket.on('state', ({ state: next, message: text }) => {
      if (next === 'attached') {
        // tmux repaints the screen on attach
        term.reset();
        setState('attached');
        requestAnimationFrame(() => {
          fit.fit();
          socket.emit('resize', { cols: term.cols, rows: term.rows });
          term.focus();
        });
      } else {
        if (next === 'unavailable') wantAttach.current = false;
        setState(next, text);
      }
    });
    socket.on('windows', setWindows);
    socket.on('window-error', ({ message: text }) => setError(text));
    socket.on('output', (data) => {
      const bytes = new Uint8Array(data);
      term.write(bytes, () => socket.emit('ack', bytes.length));
    });
    socket.on('exit', async () => {
      wantAttach.current = false;
      setWindows([]);
      try {
        const res = await api.getStatus();
        setState(res.activeState === 'deactivating' ? 'stopping' : 'stopped');
      } catch (err) {
        setState('stopped');
      }
    });

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (stateRef.current === 'attached') fit.fit();
    });
    if (observer) observer.observe(containerRef.current);

    return () => {
      if (observer) observer.disconnect();
      socket.disconnect();
      term.dispose();
    };
  }, [token, api, attach, setState]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.getStatus();
        if (cancelled) return;
        setStatus(res);
        if (stateRef.current === 'stopping' && (res.activeState === 'inactive' || res.activeState === 'failed')) {
          wantAttach.current = false;
          setState('stopped');
        }
      } catch (err) {
        // the next poll retries
      }
    };
    poll();
    const timer = setInterval(poll, STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, setState]);

  const stopSession = async () => {
    setConfirmStop(false);
    try {
      await api.stop();
      wantAttach.current = false;
      setState('stopping');
    } catch (err) {
      setError(err.message);
    }
  };

  const sendWindowCommand = (event, id) => {
    if (!socketRef.current) return;
    socketRef.current.emit(event, id);
    if (termRef.current) termRef.current.focus();
  };

  const attached = state === 'attached';

  return (
    <div>
      {state === 'connecting' && <p>Connecting...</p>}
      {state === 'inactive' && <Button size="sm" className="btn mb-2" onClick={() => attach(true)}>Start session</Button>}
      {state === 'stopping' && <p>Stopping...</p>}
      {state === 'stopped' && (
        <div className="mb-2">
          <p>Session stopped</p>
          <Button size="sm" className="btn" onClick={() => attach(true)}>New session</Button>
        </div>
      )}
      {state === 'unavailable' && <Alert variant="danger">{message}</Alert>}
      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}
      {attached && (
        <Button size="sm" className="btn mb-2" onClick={() => setConfirmStop(true)}>Stop session</Button>
      )}
      <SessionStats status={status} />
      {attached && windows.length > 0 && (
        <TerminalTabs
          windows={windows}
          onSelect={(id) => sendWindowCommand('window-select', id)}
          onNew={() => sendWindowCommand('window-new')}
          onClose={(id) => sendWindowCommand('window-close', id)}
        />
      )}
      <div
        ref={containerRef}
        style={{ height: 'calc(100vh - 370px)', minHeight: 300, background: '#000', display: attached ? 'block' : 'none' }}
      />
      {attached && <p className="mt-1">Hold Shift while dragging to select text for copying.</p>}

      <Modal show={confirmStop} onHide={() => setConfirmStop(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Stop session</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>All programs started from the terminal will be terminated.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setConfirmStop(false)}>Cancel</Button>
          <Button variant="primary" onClick={stopSession}>Stop session</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

TerminalSession.propTypes = {
  token: PropTypes.string
};

export default TerminalSession;
