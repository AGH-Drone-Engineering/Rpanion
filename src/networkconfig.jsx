import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import React from 'react';
import { createNetworkApi } from './api/networkApi.js';
import ConnectionActions from './components/network/ConnectionActions.jsx';
import ConnectionEditForm from './components/network/ConnectionEditForm.jsx';
import EthernetPanel from './components/network/EthernetPanel.jsx';
import NewConnectionModal from './components/network/NewConnectionModal.jsx';
import {
  ROLE,
  filterConnectionsForDevice,
  isFallbackProfile,
  isSystemProfile,
  pickDefaultDevice,
  resolveSelectedConnection
} from './components/network/networkModel.js';
import basePage from './basePage.jsx';
import './css/styles.css';

// NetworkManager needs a moment after deleting a profile before it is gone from `connection show`
const DELETE_RELOAD_DELAY_MS = 500;

class NetworkConfig extends basePage {
  constructor(props) {
    super(props);
    this.state = {
      ...this.state,
      netDevice: [],
      netDeviceSelected: null,
      netConnection: [],
      selectedConUuid: null,
      wirelessEnabled: true,
      apAutoReconnect: true,
      savingWifiSettings: false,
      detWifi: [],
      newCon: { show: false, key: 0, conType: 'wifi' },
      // { kind: 'delete' | 'deactivate', con }
      confirm: null,
      showModalDisableWifi: false,
      // Incremented after each load; child components re-read their data when it changes
      reloadSeq: 0
    };
    this.reloadTimer = null;
  }

  componentDidMount() {
    this.loadAll();
  }

  componentWillUnmount() {
    clearTimeout(this.reloadTimer);
    super.componentWillUnmount();
  }

  getApi() {
    if (!this.api || this.apiToken !== this.state.token) {
      this.apiToken = this.state.token;
      this.api = createNetworkApi(this.state.token);
    }
    return this.api;
  }

  // silent: keep the page visible (no loading spinner), used after actions
  loadAll = ({ silent = false } = {}) => {
    const api = this.getApi();
    if (!silent) this.setState({ loading: true });
    return Promise.all([
      api.getConnections(),
      api.getAdapters(),
      api.getWirelessStatus().catch(() => true),
      api.getWifiSettings().catch(() => null)
    ])
      .then(([netConnection, netDevice, wirelessEnabled, wifiSettings]) => {
        this.setState(prev => ({
          netConnection,
          netDevice,
          wirelessEnabled,
          netDeviceSelected: pickDefaultDevice(netDevice, prev.netDeviceSelected),
          apAutoReconnect: wifiSettings && typeof wifiSettings.apAutoReconnect === 'boolean'
            ? wifiSettings.apAutoReconnect
            : prev.apAutoReconnect,
          reloadSeq: prev.reloadSeq + 1
        }));
      })
      .catch(error => {
        this.setState({ error: 'Error loading network information: ' + error.message });
      })
      .finally(() => {
        if (!silent) this.loadDone();
      });
  };

  reloadSilently = () => this.loadAll({ silent: true });

  refresh = () => {
    this.setState({ waiting: true });
    this.loadAll({ silent: true }).finally(() => this.setState({ waiting: false }));
  };

  // Runs an action behind the waiting overlay, then reloads without hiding the page
  runAction(action, { successMessage, errorPrefix, reloadOnError = false, reloadDelay = 0 }) {
    this.setState({ waiting: true });
    const reload = () => {
      if (reloadDelay > 0) {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(this.reloadSilently, reloadDelay);
      } else {
        this.reloadSilently();
      }
    };
    return action()
      .then(() => {
        this.setState({ waiting: false, infoMessage: successMessage });
        reload();
      })
      .catch(error => {
        this.setState({ waiting: false, error: errorPrefix + error.message });
        if (reloadOnError) reload();
      });
  }

  showError = (message) => this.setState({ error: message });

  showInfo = (message) => this.setState({ infoMessage: message });

  handleAdapterChange = (event) => {
    this.setState({ netDeviceSelected: event.target.value, selectedConUuid: null });
  };

  handleConnectionChange = (event) => {
    this.setState({ selectedConUuid: event.target.value || null });
  };

  activateConnection = (con, options = {}) => {
    this.runAction(() => this.getApi().activate(con.value), {
      successMessage: 'Network Activated',
      errorPrefix: 'Error activating network: ',
      ...options
    });
  };

  promptDeactivate = (con) => {
    if (isFallbackProfile(con)) {
      this.showError('Cannot deactivate fallback profile ' + con.labelPre);
      return;
    }
    this.setState({ confirm: { kind: 'deactivate', con } });
  };

  promptDelete = (con) => {
    if (isSystemProfile(con)) {
      this.showError('Cannot delete system profile ' + con.labelPre);
      return;
    }
    this.setState({ confirm: { kind: 'delete', con } });
  };

  closeConfirm = () => this.setState({ confirm: null });

  confirmAction = () => {
    const { confirm } = this.state;
    this.setState({ confirm: null });
    if (!confirm) return;
    const api = this.getApi();
    if (confirm.kind === 'deactivate') {
      this.runAction(() => api.deactivate(confirm.con.value), {
        successMessage: 'Network Deactivated',
        errorPrefix: 'Error deactivating network: '
      });
    } else {
      this.runAction(() => api.remove(confirm.con.value), {
        successMessage: 'Network Deleted',
        errorPrefix: 'Error deleting network: ',
        reloadDelay: DELETE_RELOAD_DELAY_MS
      });
    }
  };

  saveConnection = (uuid, conSettings) => {
    this.runAction(() => this.getApi().edit(uuid, conSettings), {
      successMessage: 'Network Edited',
      errorPrefix: 'Error editing network: '
    });
  };

  openAddModal = () => {
    const device = this.getSelectedDevice();
    const conType = device ? device.type : 'ethernet';
    const open = () => this.setState(prev => ({
      waiting: false,
      newCon: { show: true, key: prev.newCon.key + 1, conType }
    }));
    if (conType !== 'wifi') {
      open();
      return;
    }
    this.setState({ waiting: true });
    // The modal opens with the previous scan result if scanning fails
    this.getApi().scanWifi()
      .then(detWifi => this.setState({ detWifi }))
      .catch(error => console.error('Wi-Fi scan failed: ' + error.message))
      .finally(open);
  };

  closeNewConModal = () => {
    this.setState(prev => ({ newCon: { ...prev.newCon, show: false } }));
  };

  refreshWifi = () => {
    this.setState({ waiting: true });
    this.getApi().scanWifi()
      .then(detWifi => this.setState({ detWifi, waiting: false }))
      .catch(error => this.setState({ waiting: false, error: 'Error scanning Wi-Fi networks: ' + error.message }));
  };

  createConnection = (conName, conSettings) => {
    const device = this.getSelectedDevice();
    this.runAction(() => this.getApi().add({
      conName,
      conType: device ? device.type : '',
      conAdapter: this.state.netDeviceSelected,
      conSettings
    }).then(() => this.closeNewConModal()), {
      successMessage: 'Network Added',
      errorPrefix: 'Error adding network: '
    });
  };

  handleWifiCheckboxChange = (event) => {
    if (event.target.checked) {
      this.setWirelessStatus(true);
    } else {
      this.setState({ showModalDisableWifi: true });
    }
  };

  handleCloseModalDisableWifi = () => {
    this.setState({ showModalDisableWifi: false });
  };

  confirmDisableWifi = () => {
    this.setState({ showModalDisableWifi: false });
    this.setWirelessStatus(false);
  };

  setWirelessStatus = (value) => {
    this.runAction(() => this.getApi().setWirelessStatus(value)
      .then(wirelessEnabled => this.setState({ wirelessEnabled })), {
      successMessage: null,
      errorPrefix: 'Error toggling wireless: '
    });
  };

  handleToggleApAutoReconnect = (e) => {
    const enabled = e.target.checked;
    this.setState({ apAutoReconnect: enabled, savingWifiSettings: true });
    this.getApi().setWifiSettings({ apAutoReconnect: enabled })
      .then(() => {
        this.setState({
          savingWifiSettings: false,
          infoMessage: enabled
            ? 'Fallback AP will periodically scan and reconnect to known Wi-Fi networks.'
            : 'Fallback AP will remain active permanently without background scanning.'
        });
      })
      .catch(err => {
        this.setState({ savingWifiSettings: false, error: 'Error saving Wi-Fi settings: ' + err.message });
      });
  };

  getSelectedDevice() {
    return this.state.netDevice.find(dev => dev.value === this.state.netDeviceSelected);
  }

  renderTitle() {
    return 'Network Configuration';
  }

  renderWifiSettings() {
    return (
      <>
        <div className="form-group row" style={{ marginBottom: '10px' }}>
          <label className="col-sm-4 col-form-label"></label>
          <div className="col-sm-8">
            <Form.Check
              type="checkbox"
              id="wifi-enabled-check"
              label="Wifi interfaces enabled"
              checked={this.state.wirelessEnabled}
              onChange={this.handleWifiCheckboxChange}
            />
          </div>
        </div>

        <div className="form-group row" style={{ marginBottom: '15px' }}>
          <label className="col-sm-4 col-form-label" htmlFor="ap-autoreconnect-switch">AP Fallback Mode</label>
          <div className="col-sm-8 d-flex align-items-center">
            <Form.Check
              type="switch"
              id="ap-autoreconnect-switch"
              label="Auto-reconnect to Wi-Fi networks while in AP"
              checked={this.state.apAutoReconnect}
              onChange={this.handleToggleApAutoReconnect}
              disabled={this.state.savingWifiSettings || !this.state.wirelessEnabled}
              className="mb-0"
            />
            <OverlayTrigger
              placement="top"
              overlay={
                <Tooltip id="ap-reconnect-tooltip">
                  Periodically scans for known Wi-Fi networks to reconnect. May cause brief Wi-Fi latency/jitter.
                </Tooltip>
              }
            >
              <span
                className="badge rounded-pill bg-light text-secondary border ms-2"
                style={{ cursor: 'help', fontSize: '0.75rem', padding: '3px 7px' }}
              >
                ?
              </span>
            </OverlayTrigger>
          </div>
        </div>
      </>
    );
  }

  // Wi-Fi and tunnel adapters: profile list, actions and edit form
  renderConnectionPanel(selectedDevice, filtered) {
    const selectedConnection = resolveSelectedConnection(filtered, this.state.selectedConUuid);
    const isWifi = Boolean(selectedDevice && selectedDevice.type === 'wifi');
    const wifiDisabled = isWifi && !this.state.wirelessEnabled;
    const isConnected = Boolean(selectedConnection && selectedConnection.state !== '');
    const userConnections = filtered.filter(c => !isSystemProfile(c));
    const systemConnections = filtered.filter(c => isSystemProfile(c));

    return (
      <>
        <div className="form-group row" style={{ marginBottom: '10px' }}>
          <label className="col-sm-4 col-form-label" htmlFor="connection-select">Connection</label>
          <div className="col-sm-8 d-flex align-items-center">
            <Form.Select
              id="connection-select"
              onChange={this.handleConnectionChange}
              value={selectedConnection ? selectedConnection.value : ''}
            >
              {userConnections.length > 0 && (
                <optgroup label={isWifi ? 'Saved Wi-Fi Networks' : 'Custom Connections'}>
                  {userConnections.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              )}
              {systemConnections.length > 0 && (
                <optgroup label="System & Fallback Profiles" style={{ color: '#6c757d' }}>
                  {systemConnections.map(option => {
                    const isFallback = isFallbackProfile(option);
                    return (
                      <option
                        key={option.value}
                        value={option.value}
                        style={{ color: isFallback ? '#6c757d' : '#212529', fontStyle: isFallback ? 'italic' : 'normal' }}
                      >
                        {option.label}
                      </option>
                    );
                  })}
                </optgroup>
              )}
            </Form.Select>
            {selectedConnection && (
              isConnected ? (
                <span className="badge bg-success ms-2">Active</span>
              ) : (
                <span className="badge bg-secondary ms-2">Inactive</span>
              )
            )}
            {isFallbackProfile(selectedConnection) && (
              <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle ms-1">Fallback</span>
            )}
            {selectedConnection && selectedConnection.role === ROLE.ETH_CLIENT && (
              <span className="badge bg-light text-secondary border ms-1">System Default</span>
            )}
          </div>
        </div>

        <div>
          {isWifi && this.renderWifiSettings()}

          <ConnectionActions
            connection={selectedConnection}
            disabled={wifiDisabled}
            onActivate={this.activateConnection}
            onDeactivate={this.promptDeactivate}
            onDelete={this.promptDelete}
            onRefresh={this.refresh}
          >
            <Button
              size="sm"
              variant="primary"
              onClick={this.openAddModal}
              disabled={Boolean(selectedConnection && selectedConnection.type === 'tun') || wifiDisabled}
              className="addConnection"
            >
              + Add Connection
            </Button>
          </ConnectionActions>

          {selectedConnection && (
            <ConnectionEditForm
              api={this.getApi()}
              connection={selectedConnection}
              device={selectedDevice}
              disabled={wifiDisabled}
              reloadSeq={this.state.reloadSeq}
              onSave={this.saveConnection}
              onError={this.showError}
            />
          )}
        </div>
      </>
    );
  }

  renderContent() {
    const selectedDevice = this.getSelectedDevice();
    const filtered = filterConnectionsForDevice(this.state.netConnection, selectedDevice);
    const isEthernet = Boolean(selectedDevice && selectedDevice.type === 'ethernet');
    const { confirm } = this.state;
    const confirmName = confirm ? (confirm.con.labelPre || confirm.con.label) : '';

    return (
      <div style={{ maxWidth: 760, width: '100%' }}>
        <p><i>Create, view, edit and delete network connections</i></p>
        <h2>Select Connection</h2>
        <p><i>Show a specific network connection, filtered by network adapter</i></p>

        <div className="form-group row" style={{ marginBottom: '10px' }}>
          <label className="col-sm-4 col-form-label" htmlFor="adapter-select">Adapter</label>
          <div className="col-sm-8">
            <Form.Select id="adapter-select" onChange={this.handleAdapterChange} value={this.state.netDeviceSelected || ''}>
              {this.state.netDevice.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Form.Select>
          </div>
        </div>

        {isEthernet ? (
          <EthernetPanel
            api={this.getApi()}
            device={selectedDevice}
            connections={filtered}
            allConnections={this.state.netConnection}
            waiting={this.state.waiting}
            reloadSeq={this.state.reloadSeq}
            onActivate={this.activateConnection}
            onDeactivate={this.promptDeactivate}
            onDelete={this.promptDelete}
            onRefresh={this.refresh}
            onSave={this.saveConnection}
            onReload={this.reloadSilently}
            onError={this.showError}
            onInfo={this.showInfo}
          />
        ) : (
          this.renderConnectionPanel(selectedDevice, filtered)
        )}

        <NewConnectionModal
          key={this.state.newCon.key}
          show={this.state.newCon.show}
          conType={this.state.newCon.conType}
          device={selectedDevice}
          detWifi={this.state.detWifi}
          onClose={this.closeNewConModal}
          onCreate={this.createConnection}
          onError={this.showError}
          onRefreshWifi={this.refreshWifi}
        />

        <Modal show={Boolean(confirm && confirm.kind === 'delete')} onHide={this.closeConfirm}>
          <Modal.Header closeButton>
            <Modal.Title>Confirm Delete</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Are you sure you want to delete the network connection &apos;{confirmName}&apos;?</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="danger" onClick={this.confirmAction}>Delete</Button>
            <Button variant="secondary" onClick={this.closeConfirm}>Cancel</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={Boolean(confirm && confirm.kind === 'deactivate')} onHide={this.closeConfirm}>
          <Modal.Header closeButton>
            <Modal.Title>Confirm Deactivation</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Are you sure you want to deactivate &apos;{confirmName}&apos;? If you are currently connected through this network, your session may disconnect.</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="warning" onClick={this.confirmAction}>Deactivate</Button>
            <Button variant="secondary" onClick={this.closeConfirm}>Cancel</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={this.state.showModalDisableWifi} onHide={this.handleCloseModalDisableWifi}>
          <Modal.Header closeButton>
            <Modal.Title>Disable Wi-Fi</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Are you sure you want to disable all Wi-Fi interfaces? Any active Wi-Fi connection or Access Point will be disconnected.</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="danger" onClick={this.confirmDisableWifi}>Disable Wi-Fi</Button>
            <Button variant="secondary" onClick={this.handleCloseModalDisableWifi}>Cancel</Button>
          </Modal.Footer>
        </Modal>
      </div>
    );
  }
}

export default NetworkConfig;
