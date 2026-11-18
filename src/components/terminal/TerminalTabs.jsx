import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';
import Nav from 'react-bootstrap/Nav';

// Same limits as MAX_WINDOWS and MAX_TAB_NAME in server/terminal.js, which enforces them
export const MAX_TABS = 8;
export const MAX_TAB_NAME = 32;

// Inline name editor: Enter or leaving the field saves, Escape cancels. An empty name returns
// the tab to automatic naming (name of the running program).
function TabNameInput({ initial, onSave, onCancel }) {
  const [value, setValue] = useState(initial);
  const [done, setDone] = useState(false);
  const finish = (save) => {
    if (done) return;
    setDone(true);
    if (save) onSave(value.trim());
    else onCancel();
  };
  return (
    <input
      type="text"
      aria-label="Tab name"
      className="form-control form-control-sm d-inline-block"
      style={{ width: '12em' }}
      value={value}
      maxLength={MAX_TAB_NAME}
      autoFocus
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') finish(false);
      }}
    />
  );
}

TabNameInput.propTypes = {
  initial: PropTypes.string,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired
};

function TerminalTabs({ windows, onSelect, onNew, onClose, onRename }) {
  const [closing, setClosing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [menu, setMenu] = useState(null);
  const canClose = windows.length > 1;

  // Context menu closes on any click elsewhere, scrolling or Escape
  useEffect(() => {
    if (!menu) return undefined;
    const hide = () => setMenu(null);
    const onKey = (event) => { if (event.key === 'Escape') hide(); };
    window.addEventListener('click', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const saveName = (id, name) => {
    setEditing(null);
    onRename(id, name);
  };

  const confirmClose = () => {
    const id = closing.id;
    setClosing(null);
    onClose(id);
  };

  return (
    <div className="mb-2">
      <Nav variant="tabs" as="div" role="tablist" className="flex-nowrap" style={{ overflowX: 'auto' }}>
        {windows.map((w, i) => (
          <Nav.Item key={w.id}>
            <Nav.Link
              as="button"
              type="button"
              role="tab"
              active={w.active}
              aria-selected={w.active}
              className="text-nowrap"
              title="Double-click or right-click to rename"
              onClick={() => onSelect(w.id)}
              onDoubleClick={() => setEditing(w.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ id: w.id, position: i + 1, x: event.clientX, y: event.clientY });
              }}
            >
              {i + 1}{' '}
              {editing === w.id
                ? <TabNameInput initial={w.name} onSave={(name) => saveName(w.id, name)} onCancel={() => setEditing(null)} />
                : w.name}
              {canClose && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Close tab ${i + 1}`}
                  className="ms-2"
                  onClick={(event) => { event.stopPropagation(); setClosing({ id: w.id, position: i + 1 }); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      setClosing({ id: w.id, position: i + 1 });
                    }
                  }}
                >
                  &times;
                </span>
              )}
            </Nav.Link>
          </Nav.Item>
        ))}
        <Nav.Item>
          <Nav.Link
            as="button"
            type="button"
            role="button"
            aria-label="New tab"
            disabled={windows.length >= MAX_TABS}
            onClick={onNew}
          >
            +
          </Nav.Link>
        </Nav.Item>
      </Nav>

      {menu && (
        <div
          role="menu"
          className="list-group shadow"
          style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1050, minWidth: '8em' }}
        >
          <button type="button" role="menuitem" className="list-group-item list-group-item-action py-1"
            onClick={() => { setEditing(menu.id); setMenu(null); }}>
            Rename
          </button>
          <button type="button" role="menuitem" className="list-group-item list-group-item-action py-1"
            disabled={!canClose}
            onClick={() => { setClosing({ id: menu.id, position: menu.position }); setMenu(null); }}>
            Close
          </button>
        </div>
      )}

      <Modal show={closing !== null} onHide={() => setClosing(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Close tab</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Programs running in this tab will be terminated.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setClosing(null)}>Cancel</Button>
          <Button variant="primary" onClick={confirmClose}>Close tab</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

TerminalTabs.propTypes = {
  windows: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    active: PropTypes.bool
  })).isRequired,
  onSelect: PropTypes.func.isRequired,
  onNew: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  onRename: PropTypes.func.isRequired
};

export default TerminalTabs;
