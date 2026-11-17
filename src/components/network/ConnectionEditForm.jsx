import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Accordion from 'react-bootstrap/Accordion';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import IPAddressInput from '../IPAddressInput.jsx';
import { FormRow, PasswordField, IpTypeRadios } from './FormFields.jsx';
import {
  BAND_TYPES,
  DEFAULT_SERVER_IP,
  DEFAULT_SUBNET,
  ROLE,
  WPA_TYPES,
  channelsForBand,
  isFallbackProfile,
  toFormSettings,
  toPriority
} from './networkModel.js';

const ID = 'con-edit';

// Editable settings of one connection profile. The draft is stored together
// with the UUID it was loaded for, so a reply for a previously selected
// profile is dropped and Save always writes the profile the draft belongs to.
function ConnectionEditForm({ api, connection, device, disabled, reloadSeq, onSave, onError }) {
  const uuid = connection.value;
  const [loaded, setLoaded] = useState({ uuid: null, details: {}, draft: toFormSettings({}) });
  const [showPW, setShowPW] = useState(false);

  useEffect(() => {
    let current = true;
    api.getConnectionDetails(uuid)
      .then(details => {
        if (current) setLoaded({ uuid, details, draft: toFormSettings(details) });
      })
      .catch(err => {
        if (current) onError('Error loading connection details: ' + err.message);
      });
    return () => {
      current = false;
    };
  // onError is left out: a new callback identity must not trigger a reload
  }, [api, uuid, reloadSeq]);

  const ready = loaded.uuid === uuid;
  const draft = loaded.draft;
  const isEthernetServer = connection.role === ROLE.ETH_SERVER;
  const isClientDefault = connection.role === ROLE.ETH_CLIENT;
  const isFallback = isFallbackProfile(connection);

  const setDraft = (update) => setLoaded(prev => ({ ...prev, draft: update(prev.draft) }));

  const changeHandler = (event) => {
    const { name, value } = event.target;
    setDraft(prev => {
      if (name === 'ipaddresstype' && value === 'shared') {
        return {
          ...prev,
          ipaddresstype: value,
          ipaddress: prev.ipaddress || DEFAULT_SERVER_IP,
          subnet: prev.subnet || DEFAULT_SUBNET
        };
      }
      if (name === 'band') return { ...prev, band: value, channel: '0' };
      if (name === 'priority') return { ...prev, priority: toPriority(value) };
      return { ...prev, [name]: value };
    });
  };

  const resetForm = () => setLoaded(prev => ({ ...prev, draft: toFormSettings(prev.details) }));

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!ready) return;
    if (isEthernetServer && draft.ipaddresstype !== 'shared') {
      onError('Cannot modify IP mode for fallback profile Ethernet-Server');
      return;
    }
    onSave(loaded.uuid, draft);
  };

  const showIpConfig = draft.mode !== 'adhoc' && draft.mode !== 'ap';
  const wpaOptions = WPA_TYPES.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>);

  return (
    <Accordion className="mt-4" defaultActiveKey={null}>
      <Accordion.Item eventKey="0">
        <Accordion.Header>
          Edit Connection: <strong className="ms-1">{connection.labelPre}</strong>
          {isFallback && (
            <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle ms-2">Fallback</span>
          )}
          {isClientDefault && (
            <span className="badge bg-light text-secondary border ms-2">System Default</span>
          )}
        </Accordion.Header>
        <Accordion.Body>
          <Form onSubmit={handleSubmit}>
            <fieldset disabled={disabled || !ready}>
              {showIpConfig && (
                <div className="ipconfig">
                  <h3>IP Address</h3>
                  <FormRow label="IP Address Type" labelId={`${ID}-iptype-label`}>
                    <IpTypeRadios
                      idPrefix={`${ID}-iptype`}
                      value={draft.ipaddresstype}
                      onChange={changeHandler}
                      disabled={{ auto: isEthernetServer, manual: isEthernetServer || isClientDefault, shared: isClientDefault }}
                    />
                    {isClientDefault && (
                      <Form.Text className="text-muted d-block mt-1">
                        System Default Ethernet is locked to DHCP Client.
                      </Form.Text>
                    )}
                    {isEthernetServer && (
                      <Form.Text className="text-muted d-block mt-1">
                        System Fallback Server is locked to DHCP Server (10.0.3.1).
                      </Form.Text>
                    )}
                  </FormRow>

                  {draft.ipaddresstype !== 'auto' && (
                    <>
                      <FormRow label={draft.ipaddresstype === 'shared' ? 'Gateway IP' : 'IP Address'} htmlFor={`${ID}-ipaddress-0`}>
                        <IPAddressInput idPrefix={`${ID}-ipaddress`} name="ipaddress" value={draft.ipaddress || ''} onChange={changeHandler} />
                      </FormRow>
                      <FormRow label="Subnet Mask" htmlFor={`${ID}-subnet-0`}>
                        <IPAddressInput idPrefix={`${ID}-subnet`} name="subnet" value={draft.subnet || ''} onChange={changeHandler} />
                      </FormRow>
                    </>
                  )}
                </div>
              )}

              {draft.mode === 'infrastructure' && (
                <div className="wificlientconfig">
                  <h3>Wifi Client</h3>
                  <FormRow label="SSID Name" htmlFor={`${ID}-ssid`}>
                    <Form.Control id={`${ID}-ssid`} name="ssid" onChange={changeHandler} value={draft.ssid} type="text" />
                  </FormRow>
                  <FormRow label="Security" htmlFor={`${ID}-wpatype`}>
                    <Form.Select id={`${ID}-wpatype`} name="wpaType" value={draft.wpaType} onChange={changeHandler}>
                      {wpaOptions}
                    </Form.Select>
                  </FormRow>
                  {draft.wpaType !== 'none' && (
                    <FormRow label="Password" htmlFor={`${ID}-password`}>
                      <PasswordField id={`${ID}-password`} value={draft.password} onChange={changeHandler}
                        show={showPW} onToggleShow={setShowPW} />
                    </FormRow>
                  )}
                </div>
              )}

              {(draft.mode === 'ap' || draft.mode === 'adhoc') && (
                <div className="wifiapconfig">
                  <h3>Wifi Access Point</h3>
                  <FormRow label="SSID Name" htmlFor={`${ID}-ssid`}>
                    {/* WiFiAP SSID is the device name, set on the Device Settings page */}
                    <Form.Control id={`${ID}-ssid`} name="ssid" onChange={changeHandler} value={draft.ssid} type="text"
                      readOnly={connection.role === ROLE.WIFI_AP} />
                  </FormRow>
                  <FormRow label="Band" htmlFor={`${ID}-band`}>
                    <Form.Select id={`${ID}-band`} name="band" onChange={changeHandler} value={draft.band}>
                      {BAND_TYPES.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </Form.Select>
                  </FormRow>
                  <FormRow label="Channel" htmlFor={`${ID}-channel`}>
                    <Form.Select id={`${ID}-channel`} name="channel" onChange={changeHandler} value={draft.channel}>
                      {channelsForBand(device, draft.band).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </Form.Select>
                  </FormRow>
                  <FormRow label="Security" htmlFor={`${ID}-wpatype`}>
                    <Form.Select id={`${ID}-wpatype`} name="wpaType" value={draft.wpaType} onChange={changeHandler}>
                      {wpaOptions}
                    </Form.Select>
                  </FormRow>
                  <FormRow label="Password" htmlFor={`${ID}-password`}>
                    <PasswordField id={`${ID}-password`} value={draft.password} onChange={changeHandler}
                      show={showPW} onToggleShow={setShowPW} disabled={draft.wpaType === 'none'} />
                  </FormRow>
                  <FormRow label="Starting IP Address" htmlFor={`${ID}-apip-0`}>
                    <IPAddressInput idPrefix={`${ID}-apip`} name="ipaddress" value={draft.ipaddress || ''} onChange={changeHandler} />
                  </FormRow>
                </div>
              )}

              <div className="priorityconfig">
                <h3>Connection Priority</h3>
                <FormRow label="Priority" htmlFor={`${ID}-priority`} marginBottom="15px">
                  <Form.Control id={`${ID}-priority`} name="priority" type="number" onChange={changeHandler} value={draft.priority} />
                  <Form.Text className="text-muted">
                    Higher priority connections are attempted first.
                  </Form.Text>
                </FormRow>
              </div>

              <FormRow label="">
                <Button size="sm" variant="primary" type="submit" disabled={connection.type === 'tun'}>Save Changes</Button>{' '}
                <Button size="sm" variant="secondary" onClick={resetForm}>Discard Changes</Button>
              </FormRow>
            </fieldset>
          </Form>
        </Accordion.Body>
      </Accordion.Item>
    </Accordion>
  );
}

ConnectionEditForm.propTypes = {
  api: PropTypes.object.isRequired,
  connection: PropTypes.shape({
    value: PropTypes.string.isRequired,
    labelPre: PropTypes.string,
    type: PropTypes.string,
    role: PropTypes.string
  }).isRequired,
  device: PropTypes.object,
  disabled: PropTypes.bool,
  reloadSeq: PropTypes.number.isRequired,
  onSave: PropTypes.func.isRequired,
  onError: PropTypes.func.isRequired
};

export default ConnectionEditForm;
