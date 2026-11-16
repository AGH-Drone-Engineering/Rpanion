import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Table from 'react-bootstrap/Table';
import IPAddressInput from '../IPAddressInput.jsx';
import { FormRow, PasswordField, IpTypeRadios } from './FormFields.jsx';
import {
  BAND_TYPES,
  WPA_TYPES,
  applyHotspot,
  applyManualWifi,
  applyNewConChange,
  applyScannedWifi,
  channelsForBand,
  makeNewConModal,
  toNewConSettings,
  validateNewConnection
} from './networkModel.js';

const ID = 'new-con';

// Owns the draft of a new profile. The parent remounts it (via `key`) for each
// opening so every opening starts from makeNewConModal(conType).
function NewConnectionModal({ show, conType, device, detWifi, onClose, onCreate, onError, onRefreshWifi }) {
  const [draft, setDraft] = useState(() => makeNewConModal(conType));

  if (!show) {
    return null;
  }

  const isWifi = draft.conType === 'wifi';
  const isSelectStep = isWifi && draft.step === 'select';

  let title = 'New Wired Connection';
  if (isWifi) {
    if (isSelectStep) {
      title = 'Select Wi-Fi Network';
    } else {
      title = draft.mode === 'ap' ? 'New Wi-Fi Hotspot' : 'New Wi-Fi Connection';
    }
  }

  const onChange = (event) => {
    const { name, value } = event.target;
    setDraft(prev => applyNewConChange(prev, name, value));
  };
  const setShowPW = (checked) => setDraft(prev => ({ ...prev, showPW: checked }));
  const selectScanned = (item) => setDraft(prev => applyScannedWifi(prev, item.ssid, item.security));

  const submit = (event) => {
    if (event) event.preventDefault();
    const error = validateNewConnection(draft);
    if (error) {
      onError(error);
      return;
    }
    onCreate(draft.conName.trim(), toNewConSettings(draft));
  };

  const wpaSelect = (
    <FormRow label="Security" htmlFor={`${ID}-wpatype`} marginBottom="10px">
      <Form.Select id={`${ID}-wpatype`} name="wpaType" value={draft.wpaType} onChange={onChange}>
        {WPA_TYPES.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </Form.Select>
    </FormRow>
  );

  const passwordRow = draft.wpaType !== 'none' && (
    <FormRow label="Password" htmlFor={`${ID}-password`} marginBottom="10px">
      <PasswordField
        id={`${ID}-password`}
        value={draft.password}
        onChange={onChange}
        show={draft.showPW}
        onToggleShow={setShowPW}
        placeholder="8-63 characters"
      />
    </FormRow>
  );

  const ssidRow = (
    <FormRow label="SSID Name" htmlFor={`${ID}-ssid`} marginBottom="10px">
      <Form.Control id={`${ID}-ssid`} name="ssid" type="text" value={draft.ssid} onChange={onChange} required />
    </FormRow>
  );

  return (
    <Modal show={show} onHide={onClose} size={isSelectStep ? 'lg' : undefined}>
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {isSelectStep ? (
          <div>
            <p>Select an available WiFi network to connect, or create a hotspot.</p>
            <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
              <Table striped bordered hover size="sm">
                <thead>
                  <tr>
                    <th>SSID</th>
                    <th>Signal</th>
                    <th>Security</th>
                  </tr>
                </thead>
                <tbody>
                  {detWifi && detWifi.length > 0 ? (
                    detWifi.map(item => (
                      <tr
                        key={item.ssid}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectScanned(item)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            selectScanned(item);
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                        title="Click to configure"
                      >
                        <td className="fw-semibold text-primary">{item.ssid}</td>
                        <td>{`${item.signal}%`}</td>
                        <td>{item.security || 'Open'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" className="text-center text-muted py-3">
                        No networks found. Try refreshing or enter network manually below.
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </div>
        ) : (
          <Form onSubmit={submit}>
            <FormRow label="Connection Name" htmlFor={`${ID}-name`} marginBottom="10px">
              <Form.Control
                id={`${ID}-name`}
                name="conName"
                type="text"
                value={draft.conName}
                onChange={onChange}
                placeholder="e.g. MyNetwork"
                required
                autoFocus
              />
            </FormRow>

            {draft.mode === 'infrastructure' && (
              <>
                {ssidRow}
                {wpaSelect}
                {passwordRow}
              </>
            )}

            {draft.mode === 'ap' && (
              <>
                {ssidRow}
                <FormRow label="Band" htmlFor={`${ID}-band`} marginBottom="10px">
                  <Form.Select id={`${ID}-band`} name="band" value={draft.band} onChange={onChange}>
                    {BAND_TYPES.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </Form.Select>
                </FormRow>
                <FormRow label="Channel" htmlFor={`${ID}-channel`} marginBottom="10px">
                  <Form.Select id={`${ID}-channel`} name="channel" value={draft.channel} onChange={onChange}>
                    {channelsForBand(device, draft.band).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </Form.Select>
                </FormRow>
                {wpaSelect}
                {passwordRow}
                <FormRow label="Starting IP" htmlFor={`${ID}-apip-0`} marginBottom="10px">
                  <IPAddressInput idPrefix={`${ID}-apip`} name="ipaddress" value={draft.ipaddress || ''} onChange={onChange} />
                </FormRow>
              </>
            )}

            {!isWifi && (
              <>
                <FormRow label="IP Address Type" labelId={`${ID}-iptype-label`} marginBottom="10px">
                  <IpTypeRadios idPrefix={`${ID}-iptype`} value={draft.ipaddresstype} onChange={onChange} />
                </FormRow>
                {draft.ipaddresstype !== 'auto' && (
                  <>
                    <FormRow
                      label={draft.ipaddresstype === 'shared' ? 'Gateway IP' : 'IP Address'}
                      htmlFor={`${ID}-ipaddress-0`}
                      marginBottom="10px"
                    >
                      <IPAddressInput idPrefix={`${ID}-ipaddress`} name="ipaddress" value={draft.ipaddress || ''} onChange={onChange} />
                    </FormRow>
                    <FormRow label="Subnet Mask" htmlFor={`${ID}-subnet-0`} marginBottom="10px">
                      <IPAddressInput idPrefix={`${ID}-subnet`} name="subnet" value={draft.subnet || ''} onChange={onChange} />
                    </FormRow>
                  </>
                )}
              </>
            )}

            <FormRow label="Priority" htmlFor={`${ID}-priority`} marginBottom="10px">
              <Form.Control id={`${ID}-priority`} name="priority" type="number" value={draft.priority} onChange={onChange} />
            </FormRow>
          </Form>
        )}
      </Modal.Body>

      <Modal.Footer>
        {isSelectStep ? (
          <>
            <Button variant="outline-primary" onClick={() => setDraft(prev => applyHotspot(prev))}>Create Wi-Fi Hotspot</Button>
            <Button variant="outline-secondary" onClick={() => setDraft(prev => applyManualWifi(prev))}>Enter SSID Manually</Button>
            <Button variant="outline-secondary" onClick={onRefreshWifi}>Refresh List</Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </>
        ) : (
          <>
            {isWifi && (
              <Button variant="outline-secondary" onClick={() => setDraft(prev => ({ ...prev, step: 'select' }))}>
                &larr; Back
              </Button>
            )}
            <Button variant="primary" onClick={submit}>Create Connection</Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}

NewConnectionModal.propTypes = {
  show: PropTypes.bool.isRequired,
  conType: PropTypes.string.isRequired,
  device: PropTypes.object,
  detWifi: PropTypes.array.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreate: PropTypes.func.isRequired,
  onError: PropTypes.func.isRequired,
  onRefreshWifi: PropTypes.func.isRequired
};

export default NewConnectionModal;
