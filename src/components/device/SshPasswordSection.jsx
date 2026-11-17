import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import { createSystemApi } from '../../api/systemApi.js';

const MIN_LENGTH = 8;
const MAX_LENGTH = 64;

function SshPasswordSection({ token }) {
  const api = useMemo(() => createSystemApi(token), [token]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const lengthOk = password.length >= MIN_LENGTH && password.length <= MAX_LENGTH;
  const valid = lengthOk && password === confirm;

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.setSshPassword(password);
      setPassword('');
      setConfirm('');
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Form.Group controlId="sshPassword">
        <Form.Label>SSH password (user pi)</Form.Label>
        <Form.Control
          type="password"
          autoComplete="new-password"
          value={password}
          isInvalid={password !== '' && !lengthOk}
          onChange={(e) => { setPassword(e.target.value); setSaved(false); }}
        />
        <Form.Control.Feedback type="invalid">
          {MIN_LENGTH}-{MAX_LENGTH} characters
        </Form.Control.Feedback>
      </Form.Group>
      <Form.Group controlId="sshPasswordConfirm" className="mt-2">
        <Form.Label>Confirm password</Form.Label>
        <Form.Control
          type="password"
          autoComplete="new-password"
          value={confirm}
          isInvalid={confirm !== '' && confirm !== password}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Form.Group>
      <Button size="sm" className="btn mt-2" disabled={saving || !valid} onClick={save}>
        Change Password
      </Button>
      {saved && <Alert variant="success" className="mt-2">SSH password updated</Alert>}
      {error && <Alert variant="danger" className="mt-2">{error}</Alert>}
    </div>
  );
}

SshPasswordSection.propTypes = {
  token: PropTypes.string
};

export default SshPasswordSection;
