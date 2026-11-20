import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import { createSystemApi } from '../../api/systemApi.js';

// Same rules as server/systemIdentity.js; the name is also the AP SSID (max 32 bytes)
const DEVICE_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

function isValidDeviceName(name) {
  return DEVICE_NAME_RE.test(name) && name !== 'localhost' && !/^[0-9]+$/.test(name);
}

function mdnsUrl(hostname) {
  const port = window.location.port ? `:${window.location.port}` : '';
  return `http://${hostname}.local${port}`;
}

function DeviceNameSection({ token }) {
  const api = useMemo(() => createSystemApi(token), [token]);
  const [current, setCurrent] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getIdentity()
      .then((identity) => {
        setCurrent(identity.hostname);
        setName(identity.hostname);
      })
      .catch((err) => setError(err.message));
  }, [api]);

  const normalized = name.trim().toLowerCase();
  const valid = isValidDeviceName(normalized);

  const save = async (updateApSsid) => {
    setConfirming(false);
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const identity = await api.setHostname(normalized, updateApSsid);
      setCurrent(identity.hostname);
      setName(identity.hostname);
      setSaved({ updateApSsid });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Form.Group controlId="deviceName">
        <Form.Label>Device name</Form.Label>
        <div className="d-flex">
          <Form.Control
            type="text"
            value={name}
            isInvalid={name !== '' && !valid}
            onChange={(e) => { setName(e.target.value); setSaved(null); }}
          />
          <Button
            size="sm"
            className="btn ms-2"
            disabled={saving || !valid || normalized === current}
            onClick={() => setConfirming(true)}
          >
            Save
          </Button>
        </div>
        <Form.Text className="text-muted">
          System hostname; also the mDNS address{current && <> <b>{current}.local</b></>}
        </Form.Text>
      </Form.Group>
      {saved && (
        <Alert variant="success" className="mt-2">
          {saved.updateApSsid ? 'Device name and access point SSID' : 'Device name'}: {current},{' '}
          <a href={mdnsUrl(current)}>{current}.local</a>
        </Alert>
      )}
      <Modal show={confirming} onHide={() => setConfirming(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Change device name</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Also change the access point SSID to <b>{normalized}</b>? (recommended)
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => save(false)}>No</Button>
          <Button variant="primary" onClick={() => save(true)}>Yes</Button>
        </Modal.Footer>
      </Modal>
      {error && <Alert variant="danger" className="mt-2">{error}</Alert>}
    </div>
  );
}

DeviceNameSection.propTypes = {
  token: PropTypes.string
};

export default DeviceNameSection;
