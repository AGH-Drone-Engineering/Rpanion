import React, { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import EthernetConfigSection from './EthernetConfigSection.jsx';
import ConnectionActions from './ConnectionActions.jsx';
import ConnectionEditForm from './ConnectionEditForm.jsx';
import { DEFAULT_SERVER_IP, DEFAULT_SUBNET, ROLE, isValidIPv4 } from './networkModel.js';

const MODES = ['server', 'client', 'static'];

function StatusBadge({ active }) {
  return active
    ? <span className="badge bg-success ms-2">Active</span>
    : <span className="badge bg-secondary ms-2">Inactive</span>;
}

StatusBadge.propTypes = { active: PropTypes.bool };

// Ethernet adapter view: DHCP server / DHCP client system profiles, secondary
// static IP aliases, and any other wired profile bound to this adapter.
function EthernetPanel({
  api, device, connections, allConnections, waiting, reloadSeq,
  onActivate, onDeactivate, onDelete, onRefresh, onSave, onReload, onError, onInfo
}) {
  const [selection, setSelection] = useState(null);
  const [serverSettings, setServerSettings] = useState({ ipaddress: DEFAULT_SERVER_IP, subnet: DEFAULT_SUBNET });
  const [serverSaving, setServerSaving] = useState(false);
  const [aliases, setAliases] = useState([]);
  const [newAliasIp, setNewAliasIp] = useState('');
  const [newAliasSubnet, setNewAliasSubnet] = useState(DEFAULT_SUBNET);
  const [aliasesSaving, setAliasesSaving] = useState(false);
  const [aliasToDelete, setAliasToDelete] = useState(null);

  const findRole = (role) => connections.find(c => c.role === role) || allConnections.find(c => c.role === role);
  const serverCon = findRole(ROLE.ETH_SERVER);
  const clientCon = findRole(ROLE.ETH_CLIENT);
  const serverUuid = serverCon ? serverCon.value : null;
  const otherProfiles = connections.filter(c => c.role === null || c.role === undefined);

  const activeCon = allConnections.find(c => c.type === '802-3-ethernet' && c.state === device.value);
  const isServerActive = Boolean(activeCon && activeCon.role === ROLE.ETH_SERVER);
  const isClientActive = Boolean(activeCon && activeCon.role === ROLE.ETH_CLIENT);
  const isStaticActive = aliases.some(a => a.active);
  const activeOther = otherProfiles.find(c => c.isActive);

  let current = selection;
  if (!MODES.includes(current) && !otherProfiles.some(c => c.value === current)) {
    current = isServerActive ? 'server' : (activeOther ? activeOther.value : 'client');
  }
  const otherCon = MODES.includes(current) ? null : otherProfiles.find(c => c.value === current);

  // Background reads keep the previous values on failure, as before the refactor
  const fetchAliases = useCallback(() => {
    api.getEthernetAliases()
      .then(setAliases)
      .catch(err => console.error('Error loading static IP aliases: ' + err.message));
  }, [api]);

  useEffect(() => {
    fetchAliases();
  }, [fetchAliases, reloadSeq]);

  useEffect(() => {
    if (!serverUuid) return undefined;
    let active = true;
    api.getConnectionDetails(serverUuid)
      .then(details => {
        if (active) {
          setServerSettings({ ipaddress: details.IP || DEFAULT_SERVER_IP, subnet: details.subnet || DEFAULT_SUBNET });
        }
      })
      .catch(err => console.error('Error loading DHCP server settings: ' + err.message));
    return () => {
      active = false;
    };
  }, [api, serverUuid, reloadSeq]);

  const activateMode = (con, label) => {
    if (!con) {
      onError(`Connection profile ${label} not found`);
      return;
    }
    onActivate(con, { successMessage: `${con.labelPre} Activated`, errorPrefix: `Error activating ${con.labelPre}: `, reloadOnError: true });
  };

  const saveServer = () => {
    if (!serverCon) {
      onError('Ethernet-Server connection profile not found');
      return;
    }
    setServerSaving(true);
    api.edit(serverCon.value, { ipaddresstype: 'shared', ipaddress: serverSettings.ipaddress, subnet: serverSettings.subnet })
      .then(() => {
        setServerSaving(false);
        onInfo('DHCP Server settings saved');
        onReload();
      })
      .catch(err => {
        setServerSaving(false);
        onError('Error saving DHCP server settings: ' + err.message);
      });
  };

  const saveAliases = (list, successMessage) => {
    setAliasesSaving(true);
    return api.setEthernetAliases(list)
      .then(() => {
        setAliasesSaving(false);
        setNewAliasIp('');
        setNewAliasSubnet(DEFAULT_SUBNET);
        onInfo(successMessage);
        fetchAliases();
      })
      .catch(err => {
        setAliasesSaving(false);
        onError('Error saving aliases: ' + err.message);
      });
  };

  const addAlias = () => {
    const ip = (newAliasIp || '').trim();
    const subnet = (newAliasSubnet || DEFAULT_SUBNET).trim();
    if (!isValidIPv4(ip)) {
      onError('Please enter a valid IP address');
      return;
    }
    if (!isValidIPv4(subnet)) {
      onError('Please enter a valid Subnet Mask');
      return;
    }
    if (aliases.some(a => a.ip === ip)) {
      onError(`Alias IP ${ip} is already configured`);
      return;
    }
    saveAliases([...aliases, { id: 'alias-' + Date.now(), ip, subnet }], 'Static IP alias added successfully');
  };

  const confirmDeleteAlias = () => {
    const alias = aliasToDelete;
    setAliasToDelete(null);
    if (alias) {
      saveAliases(aliases.filter(a => a.id !== alias.id), `Static IP alias ${alias.ip} removed`);
    }
  };

  let modeActive = isStaticActive;
  if (current === 'server') modeActive = isServerActive;
  if (current === 'client') modeActive = isClientActive;

  return (
    <>
      <div className="form-group row" style={{ marginBottom: '10px' }}>
        <label className="col-sm-4 col-form-label" htmlFor="eth-connection-select">Connection</label>
        <div className="col-sm-8 d-flex align-items-center">
          <Form.Select id="eth-connection-select" value={current} onChange={(e) => setSelection(e.target.value)}>
            <option value="server">{isServerActive ? 'DHCP Server (Active)' : 'DHCP Server'}</option>
            <option value="client">{isClientActive ? 'DHCP Client (Active)' : 'DHCP Client'}</option>
            <option value="static">{isStaticActive ? 'Static IP (Active)' : 'Static IP'}</option>
            {otherProfiles.length > 0 && (
              <optgroup label="Other profiles">
                {otherProfiles.map(con => (
                  <option key={con.value} value={con.value}>{con.label}</option>
                ))}
              </optgroup>
            )}
          </Form.Select>
          <StatusBadge active={otherCon ? otherCon.state !== '' : modeActive} />
        </div>
      </div>

      {otherCon ? (
        <>
          <ConnectionActions
            connection={otherCon}
            onActivate={onActivate}
            onDeactivate={onDeactivate}
            onDelete={onDelete}
            onRefresh={onRefresh}
          />
          <ConnectionEditForm
            api={api}
            connection={otherCon}
            device={device}
            reloadSeq={reloadSeq}
            onSave={onSave}
            onError={onError}
          />
        </>
      ) : (
        <>
          <div className="form-group row" style={{ marginBottom: '15px' }}>
            <label className="col-sm-4 col-form-label">Actions</label>
            <div className="col-sm-8 d-flex flex-wrap gap-2">
              {((current === 'client' && !isClientActive) || (current === 'server' && !isServerActive)) && (
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => (current === 'server'
                    ? activateMode(serverCon, 'Ethernet-Server')
                    : activateMode(clientCon, 'Ethernet-Client'))}
                  disabled={waiting}
                  className="activateConnection"
                >
                  {waiting ? 'Activating...' : 'Activate'}
                </Button>
              )}
              <Button size="sm" variant="outline-secondary" onClick={onRefresh} className="refreshConnection ms-auto">
                Refresh
              </Button>
            </div>
          </div>

          <EthernetConfigSection
            currentEthConn={current}
            waiting={waiting}
            ethServerSettings={serverSettings}
            ethServerSaving={serverSaving}
            onServerSettingsChange={(field, val) => setServerSettings(prev => ({ ...prev, [field]: val }))}
            onSaveServer={saveServer}
            ethAliases={aliases}
            newAliasIp={newAliasIp}
            newAliasSubnet={newAliasSubnet}
            ethAliasesSaving={aliasesSaving}
            onNewAliasIpChange={setNewAliasIp}
            onNewAliasSubnetChange={setNewAliasSubnet}
            onAddAlias={addAlias}
            onPromptDeleteAlias={setAliasToDelete}
          />
        </>
      )}

      <Modal show={aliasToDelete !== null} onHide={() => setAliasToDelete(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Delete</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Are you sure you want to delete static IP alias &apos;{aliasToDelete ? aliasToDelete.ip : ''}&apos;?</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="danger" onClick={confirmDeleteAlias} disabled={aliasesSaving}>
            {aliasesSaving ? 'Deleting...' : 'Delete'}
          </Button>
          <Button variant="secondary" onClick={() => setAliasToDelete(null)} disabled={aliasesSaving}>
            Cancel
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

EthernetPanel.propTypes = {
  api: PropTypes.object.isRequired,
  device: PropTypes.shape({ value: PropTypes.string.isRequired, type: PropTypes.string }).isRequired,
  connections: PropTypes.array.isRequired,
  allConnections: PropTypes.array.isRequired,
  waiting: PropTypes.bool,
  reloadSeq: PropTypes.number.isRequired,
  onActivate: PropTypes.func.isRequired,
  onDeactivate: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onRefresh: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onReload: PropTypes.func.isRequired,
  onError: PropTypes.func.isRequired,
  onInfo: PropTypes.func.isRequired
};

export default EthernetPanel;
