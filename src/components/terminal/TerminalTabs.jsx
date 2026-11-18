import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';
import Nav from 'react-bootstrap/Nav';

// Same limit as MAX_WINDOWS in server/terminal.js, which enforces it
export const MAX_TABS = 8;

function TerminalTabs({ windows, onSelect, onNew, onClose }) {
  const [closing, setClosing] = useState(null);
  const canClose = windows.length > 1;

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
              onClick={() => onSelect(w.id)}
            >
              {i + 1} {w.name}
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
  onClose: PropTypes.func.isRequired
};

export default TerminalTabs;
