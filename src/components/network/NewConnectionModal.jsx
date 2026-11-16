import React from 'react';
import PropTypes from 'prop-types';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Table from 'react-bootstrap/Table';
import IPAddressInput from '../IPAddressInput.jsx';

function NewConnectionModal({
  modal,
  onClose,
  detWifi,
  wpaTypes,
  bandTypes,
  validChannels,
  onChange,
  onTogglePassword,
  onSelectScannedWifi,
  onSelectCreateHotspot,
  onSelectManualWifi,
  onRefreshWifi,
  onBack,
  onSubmit
}) {
  if (!modal || !modal.show) {
    return null;
  }

  const isWifi = modal.conType === 'wifi';
  const isSelectStep = isWifi && modal.step === 'select';

  let title = 'New Wired Connection';
  if (isWifi) {
    if (isSelectStep) {
      title = 'Select Wi-Fi Network';
    } else {
      title = modal.mode === 'ap' ? 'New Wi-Fi Hotspot' : 'New Wi-Fi Connection';
    }
  }

  return (
    <Modal
      show={modal.show}
      onHide={onClose}
      size={isSelectStep ? 'lg' : undefined}
    >
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
                    detWifi.map((item, index) => (
                      <tr
                        key={index}
                        onClick={() => onSelectScannedWifi(item.ssid, item.security)}
                        style={{ cursor: 'pointer' }}
                        title="Click to configure"
                      >
                        <td className="fw-semibold text-primary">{item.ssid}</td>
                        <td>
                          {typeof item.signal === 'number'
                            ? (item.signal <= 0 ? `${item.signal} dBm` : `${item.signal}%`)
                            : (item.signal || 'N/A')}
                        </td>
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
          <Form onSubmit={onSubmit}>
            <div className="form-group row" style={{ marginBottom: '10px' }}>
              <label className="col-sm-4 col-form-label">Connection Name</label>
              <div className="col-sm-8">
                <Form.Control
                  name="conName"
                  type="text"
                  value={modal.conName}
                  onChange={onChange}
                  placeholder="e.g. MyNetwork"
                  required
                  autoFocus
                />
              </div>
            </div>

            {modal.mode === 'infrastructure' && (
              <>
                <div className="form-group row" style={{ marginBottom: '10px' }}>
                  <label className="col-sm-4 col-form-label">SSID Name</label>
                  <div className="col-sm-8">
                    <Form.Control
                      name="ssid"
                      type="text"
                      value={modal.ssid}
                      onChange={onChange}
                      required
                    />
                  </div>
                </div>

                <div className="form-group row" style={{ marginBottom: '10px' }}>
                  <label className="col-sm-4 col-form-label">Security</label>
                  <div className="col-sm-8">
                    <Form.Select
                      name="wpaType"
                      value={modal.wpaType}
                      onChange={onChange}
                    >
                      {wpaTypes.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </Form.Select>
                  </div>
                </div>

                {modal.wpaType !== 'none' && (
                  <div className="form-group row" style={{ marginBottom: '10px' }}>
                    <label className="col-sm-4 col-form-label">Password</label>
                    <div className="col-sm-8">
                      <Form.Control
                        name="password"
                        type={modal.showPW ? 'text' : 'password'}
                        value={modal.password}
                        onChange={onChange}
                        isInvalid={
                          (modal.password || '').length < 8 ||
                          (modal.password || '').length > 63
                        }
                        placeholder="8-63 characters"
                      />
                      <Form.Control.Feedback type="invalid">
                        Password must be between 8 and 63 characters long.
                      </Form.Control.Feedback>
                      <Form.Check
                        type="checkbox"
                        label="Show Password"
                        checked={modal.showPW}
                        onChange={onTogglePassword}
                        style={{ marginTop: '5px' }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {modal.mode === 'ap' && (
              <>
                <div className="form-group row" style={{ marginBottom: '10px' }}>
                  <label className="col-sm-4 col-form-label">SSID Name</label>
                  <div className="col-sm-8">
                    <Form.Control
                      name="ssid"
                      type="text"
                      value={modal.ssid}
                      onChange={onChange}
                      required
                    />
                  </div>
                </div>

                <div className="form-group row" style={{ marginBottom: '10px' }}>
                  <label className="col-sm-4 col-form-label">Band</label>
                  <div className="col-sm-8">
                    <Form.Select
                      name="band"
                      value={modal.band}
                      onChange={onChange}
                    >
                      {bandTypes.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </Form.Select>
                  </div>
                </div>

                <div className="form-group row" style={{ marginBottom: '10px' }}>
                  <label className="col-sm-4 col-form-label">Channel</label>
                  <div className="col-sm-8">
                    <Form.Select
                      name="channel"
                      value={modal.channel}
                      onChange={onChange}
                    >
                      {validChannels.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </Form.Select>
                  </div>
                </div>

                <div className="form-group row" style={{ marginBottom: '10px' }}>
                  <label className="col-sm-4 col-form-label">Security</label>
                  <div className="col-sm-8">
                    <Form.Select
                      name="wpaType"
                      value={modal.wpaType}
                      onChange={onChange}
                    >
                      {wpaTypes.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </Form.Select>
                  </div>
                </div>

                {modal.wpaType !== 'none' && (
                  <div className="form-group row" style={{ marginBottom: '10px' }}>
                    <label className="col-sm-4 col-form-label">Password</label>
                    <div className="col-sm-8">
                      <Form.Control
                        name="password"
                        type={modal.showPW ? 'text' : 'password'}
                        value={modal.password}
                        onChange={onChange}
                        isInvalid={
                          (modal.password || '').length < 8 ||
                          (modal.password || '').length > 63
                        }
                        placeholder="8-63 characters"
                      />
                      <Form.Control.Feedback type="invalid">
                        Password must be between 8 and 63 characters long.
                      </Form.Control.Feedback>
                      <Form.Check
                        type="checkbox"
                        label="Show Password"
                        checked={modal.showPW}
                        onChange={onTogglePassword}
                        style={{ marginTop: '5px' }}
                      />
                    </div>
                  </div>
                )}

                <div className="form-group row" style={{ marginBottom: '10px' }}>
                  <label className="col-sm-4 col-form-label">Starting IP</label>
                  <div className="col-sm-8">
                    <IPAddressInput
                      name="ipaddress"
                      value={modal.ipaddress || ''}
                      onChange={onChange}
                    />
                  </div>
                </div>
              </>
            )}

            {modal.conType !== 'wifi' && (
              <>
                <div className="form-group row" style={{ marginBottom: '10px' }}>
                  <label className="col-sm-4 col-form-label">IP Address Type</label>
                  <div className="col-sm-8">
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="radio"
                        name="ipaddresstype"
                        value="auto"
                        onChange={onChange}
                        checked={modal.ipaddresstype === 'auto'}
                      />
                      <label className="form-check-label">DHCP Client</label>
                    </div>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="radio"
                        name="ipaddresstype"
                        value="manual"
                        onChange={onChange}
                        checked={modal.ipaddresstype === 'manual'}
                      />
                      <label className="form-check-label">Static IP</label>
                    </div>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="radio"
                        name="ipaddresstype"
                        value="shared"
                        onChange={onChange}
                        checked={modal.ipaddresstype === 'shared'}
                      />
                      <label className="form-check-label">DHCP Server</label>
                    </div>
                  </div>
                </div>

                {modal.ipaddresstype !== 'auto' && (
                  <>
                    <div className="form-group row" style={{ marginBottom: '10px' }}>
                      <label className="col-sm-4 col-form-label">
                        {modal.ipaddresstype === 'shared' ? 'Gateway IP' : 'IP Address'}
                      </label>
                      <div className="col-sm-8">
                        <IPAddressInput
                          name="ipaddress"
                          value={modal.ipaddress || ''}
                          onChange={onChange}
                        />
                      </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '10px' }}>
                      <label className="col-sm-4 col-form-label">Subnet Mask</label>
                      <div className="col-sm-8">
                        <IPAddressInput
                          name="subnet"
                          value={modal.subnet || ''}
                          onChange={onChange}
                        />
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            <div className="form-group row" style={{ marginBottom: '10px' }}>
              <label className="col-sm-4 col-form-label">Priority</label>
              <div className="col-sm-8">
                <Form.Control
                  name="priority"
                  type="number"
                  value={modal.priority !== undefined ? modal.priority : ''}
                  onChange={onChange}
                />
              </div>
            </div>
          </Form>
        )}
      </Modal.Body>

      <Modal.Footer>
        {isSelectStep ? (
          <>
            <Button variant="outline-primary" onClick={onSelectCreateHotspot}>Create Wi-Fi Hotspot</Button>
            <Button variant="outline-secondary" onClick={onSelectManualWifi}>Enter SSID Manually</Button>
            <Button variant="outline-secondary" onClick={onRefreshWifi}>Refresh List</Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </>
        ) : (
          <>
            {isWifi && (
              <Button variant="outline-secondary" onClick={onBack}>
                &larr; Back
              </Button>
            )}
            <Button variant="primary" onClick={onSubmit}>Create Connection</Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}

NewConnectionModal.propTypes = {
  modal: PropTypes.shape({
    show: PropTypes.bool,
    conType: PropTypes.string,
    step: PropTypes.string,
    conName: PropTypes.string,
    mode: PropTypes.string,
    ssid: PropTypes.string,
    wpaType: PropTypes.string,
    password: PropTypes.string,
    showPW: PropTypes.bool,
    ipaddresstype: PropTypes.string,
    ipaddress: PropTypes.string,
    subnet: PropTypes.string,
    band: PropTypes.string,
    channel: PropTypes.string,
    priority: PropTypes.oneOfType([PropTypes.number, PropTypes.string])
  }).isRequired,
  onClose: PropTypes.func.isRequired,
  detWifi: PropTypes.array.isRequired,
  wpaTypes: PropTypes.array.isRequired,
  bandTypes: PropTypes.array.isRequired,
  validChannels: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
  onTogglePassword: PropTypes.func.isRequired,
  onSelectScannedWifi: PropTypes.func.isRequired,
  onSelectCreateHotspot: PropTypes.func.isRequired,
  onSelectManualWifi: PropTypes.func.isRequired,
  onRefreshWifi: PropTypes.func.isRequired,
  onBack: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired
};

export default NewConnectionModal;
