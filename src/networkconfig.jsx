import Accordion from 'react-bootstrap/Accordion';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Table from 'react-bootstrap/Table';
import Card from 'react-bootstrap/Card';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import React from 'react';
import IPAddressInput from './components/IPAddressInput.jsx';
import EthernetConfigSection from './components/network/EthernetConfigSection.jsx';
import NewConnectionModal from './components/network/NewConnectionModal.jsx';
import './css/styles.css';

async function requestApi(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data.error || data.message || `Request failed (${res.status})`;
    throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
  }
  if (data.error) {
    throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
  }
  return data;
}

import basePage from './basePage.jsx';

class NetworkConfig extends basePage {
  constructor(props) {
    super(props);
    this.state = {
      ...this.state,
      detWifi: [],
      showModalDelete: false,
      showModalDeactivate: false,
      showModalDisableWifi: false,
      wirelessEnabled: true,
      netDevice: [],
      netDeviceSelected: null,
      netConnection: [],
      netConnectionFiltered: [],
      netConnectionFilteredSelected: null,
      netConnectionDetails: {},
      netConnectionSimilarIfaces: [],
      showIP: false,
      showPW: false,
      ethAliases: [],
      newAliasIp: '',
      newAliasSubnet: '255.255.255.0',
      ethAliasesSaving: false,
      showModalDeleteAlias: false,
      aliasToDelete: null,
      ethSelectedConnection: null,
      apAutoReconnect: true,
      savingWifiSettings: false,
      ethServerSettings: {
        ipaddress: '10.0.3.1',
        subnet: '255.255.255.0'
      },
      ethServerSaving: false,
      wpaTypes: [{ value: 'none', label: 'None' }, { value: 'wpa-psk', label: 'WPA (PSK)' }],
      bandTypes: [{ value: 'a', label: '5 GHz' }, { value: 'bg', label: '2.4 GHz' }],
      availChannels: [],
      curSettings: {
        ipaddresstype: '',
        ipaddress: '',
        subnet: '',
        wpaType: '',
        password: '',
        ssid: '',
        band: '',
        mode: '',
        attachedIface: '',
        channel: '',
        priority: ''
      },
      newConModal: {
        show: false,
        conType: 'wifi',
        step: 'select',
        conName: '',
        mode: 'infrastructure',
        ssid: '',
        wpaType: 'wpa-psk',
        password: '',
        showPW: false,
        ipaddresstype: 'auto',
        ipaddress: '',
        subnet: '',
        band: 'bg',
        channel: '0',
        priority: 100
      }
    };

    this.handleNetworkSubmit = this.handleNetworkSubmit.bind(this);
    this.deleteConnection = this.deleteConnection.bind(this);
    this.promptDeactivateConnection = this.promptDeactivateConnection.bind(this);
    this.handleCloseModalDeactivate = this.handleCloseModalDeactivate.bind(this);
    this.confirmDeactivateConnection = this.confirmDeactivateConnection.bind(this);
    this.handleWifiCheckboxChange = this.handleWifiCheckboxChange.bind(this);
    this.handleCloseModalDisableWifi = this.handleCloseModalDisableWifi.bind(this);
    this.confirmDisableWifi = this.confirmDisableWifi.bind(this);
    this.openAddModal = this.openAddModal.bind(this);
    this.closeNewConModal = this.closeNewConModal.bind(this);
    this.selectScannedWifi = this.selectScannedWifi.bind(this);
    this.selectCreateHotspot = this.selectCreateHotspot.bind(this);
    this.selectHiddenWifi = this.selectHiddenWifi.bind(this);
    this.selectManualWifi = this.selectManualWifi.bind(this);
    this.submitNewConnection = this.submitNewConnection.bind(this);
    this.refreshAll = this.refreshAll.bind(this);
  }

  componentDidMount() {
    this.handleStart();
  }

  handleStart() {
    this.setState({ loading: true });
    Promise.all([
      fetch(`/api/networkconnections`, { headers: { Authorization: `Bearer ${this.state.token}` } }).then(response => response.json()).then(state => this.setState(state)),
      fetch(`/api/wirelessstatus`, { headers: { Authorization: `Bearer ${this.state.token}` } }).then(response => response.json()).then(state => this.setState(state)),
      fetch(`/api/ethernetaliases`, { headers: { Authorization: `Bearer ${this.state.token}` } }).then(res => res.json()).then(aliases => {
        if (Array.isArray(aliases)) {
          this.setState({ ethAliases: aliases });
        }
      }).catch(() => {}),
      fetch(`/api/networkadapters`, { headers: { Authorization: `Bearer ${this.state.token}` } }).then(response => response.json()).then(state => {
        return new Promise(resolve => {
          this.setState(state, () => {
            if (state.netDevice && state.netDevice.length > 0 && !this.state.netDeviceSelected) {
              const defaultWifi = state.netDevice.find(dev => dev.type === 'wifi');
              this.setState({ netDeviceSelected: defaultWifi ? defaultWifi.value : state.netDevice[0].value });
            }
            resolve(state);
          });
        });
      })
    ]).then(retState => {
      const adapters = retState[3] && retState[3].netDevice;
      if (adapters && adapters.length > 0) {
        const defaultWifi = adapters.find(dev => dev.type === 'wifi');
        const adapterToUse = this.state.netDeviceSelected || (defaultWifi ? defaultWifi.value : adapters[0].value);
        this.handleAdapterChange({ target: { value: adapterToUse } });
      }
      this.fetchEthernetServerSettings();
      this.fetchWifiSettings();
      this.setState({ waiting: false });
      this.loadDone();
    }).catch(error => {
      this.setState({ waiting: false, error: 'Error loading network information: ' + error });
      this.loadDone();
    });
  }

  getEthernetServerConnection = () => {
    return this.state.netConnection.find(con => con.labelPre === 'Ethernet-Server');
  };

  fetchEthernetAliases = () => {
    fetch('/api/ethernetaliases', {
      headers: { Authorization: `Bearer ${this.state.token}` }
    })
      .then(res => res.json())
      .then(aliases => {
        if (Array.isArray(aliases)) {
          this.setState({ ethAliases: aliases });
        }
      })
      .catch(() => {});
  };

  fetchEthernetServerSettings = () => {
    const serverCon = this.getEthernetServerConnection();
    if (!serverCon) return;

    fetch('/api/networkIP', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      },
      body: JSON.stringify({
        conName: serverCon.value
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data && data.netConnectionDetails) {
          this.setState({
            ethServerSettings: {
              ipaddress: data.netConnectionDetails.IP || '10.0.3.1',
              subnet: data.netConnectionDetails.subnet || '255.255.255.0'
            }
          });
        }
      })
      .catch(() => {});
  };

  handleSaveEthernetServer = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const serverCon = this.getEthernetServerConnection();
    if (!serverCon) {
      this.setState({ error: 'Ethernet-Server connection profile not found' });
      return;
    }

    this.setState({ ethServerSaving: true });
    fetch('/api/networkedit', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      },
      body: JSON.stringify({
        conName: serverCon.value,
        conSettings: {
          ipaddresstype: 'shared',
          ipaddress: this.state.ethServerSettings.ipaddress,
          subnet: this.state.ethServerSettings.subnet
        }
      })
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || data.message || `Request failed (${res.status})`);
        }
        return data;
      })
      .then(data => {
        this.setState({ ethServerSaving: false });
        if (data && data.error == null) {
          this.setState({ infoMessage: 'DHCP Server settings saved' });
          this.handleStart();
        } else {
          this.setState({ error: 'Error saving DHCP server settings: ' + (data ? data.error : 'Unknown error') });
        }
      })
      .catch(err => {
        this.setState({ ethServerSaving: false, error: 'Error saving DHCP server settings: ' + (err.message || err) });
      });
  };

  saveAliasesList = (aliasesList, successMessage) => {
    this.setState({ ethAliasesSaving: true });
    fetch('/api/ethernetaliases', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      },
      body: JSON.stringify({ aliases: aliasesList })
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || data.message || `Request failed (${res.status})`);
        }
        return data;
      })
      .then(data => {
        this.setState({ ethAliasesSaving: false });
        if (data && data.error == null) {
          this.setState({
            infoMessage: successMessage,
            newAliasIp: '',
            newAliasSubnet: '255.255.255.0'
          });
          this.fetchEthernetAliases();
        } else {
          this.setState({ error: 'Error saving aliases: ' + (data ? data.error : 'Unknown error') });
        }
      })
      .catch(err => {
        this.setState({ ethAliasesSaving: false, error: 'Error saving aliases: ' + (err.message || err) });
      });
  };

  handleAddAlias = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const ip = (this.state.newAliasIp || '').trim();
    const subnet = (this.state.newAliasSubnet || '255.255.255.0').trim();

    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ip || !ipRegex.test(ip)) {
      this.setState({ error: 'Please enter a valid IP address' });
      return;
    }
    if (!subnet || !ipRegex.test(subnet)) {
      this.setState({ error: 'Please enter a valid Subnet Mask' });
      return;
    }

    if (this.state.ethAliases.some(a => a.ip === ip)) {
      this.setState({ error: `Alias IP ${ip} is already configured` });
      return;
    }

    const updated = [
      ...this.state.ethAliases,
      {
        id: 'alias-' + Date.now(),
        ip,
        subnet
      }
    ];

    this.saveAliasesList(updated, 'Static IP alias added successfully');
  };

  promptDeleteAlias = (alias) => {
    this.setState({ showModalDeleteAlias: true, aliasToDelete: alias });
  };

  handleCloseModalDeleteAlias = () => {
    this.setState({ showModalDeleteAlias: false, aliasToDelete: null });
  };

  confirmDeleteAlias = () => {
    const alias = this.state.aliasToDelete;
    if (!alias) {
      this.setState({ showModalDeleteAlias: false });
      return;
    }
    const updated = this.state.ethAliases.filter(a => a.id !== alias.id);
    this.setState({ showModalDeleteAlias: false, aliasToDelete: null });
    this.saveAliasesList(updated, `Static IP alias ${alias.ip} removed`);
  };

  handleDeleteAlias = (id) => {
    const alias = this.state.ethAliases.find(a => a.id === id);
    if (alias) {
      this.promptDeleteAlias(alias);
    } else {
      const updated = this.state.ethAliases.filter(a => a.id !== id);
      this.saveAliasesList(updated, 'Static IP alias removed');
    }
  };

  fetchWifiSettings = () => {
    fetch('/api/wifisettings', {
      headers: { Authorization: `Bearer ${this.state.token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (typeof data.apAutoReconnect === 'boolean') {
          this.setState({ apAutoReconnect: data.apAutoReconnect });
        }
      })
      .catch(() => {});
  };

  handleToggleApAutoReconnect = (e) => {
    const enabled = e.target.checked;
    this.setState({ apAutoReconnect: enabled, savingWifiSettings: true });
    fetch('/api/wifisettings', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      },
      body: JSON.stringify({ apAutoReconnect: enabled })
    })
      .then(res => res.json())
      .then(data => {
        this.setState({ savingWifiSettings: false });
        if (data && data.error) {
          this.setState({ error: 'Error saving Wi-Fi settings: ' + data.error });
        } else {
          this.setState({
            infoMessage: enabled
              ? 'Fallback AP will periodically scan and reconnect to known Wi-Fi networks.'
              : 'Fallback AP will remain active permanently without background scanning.'
          });
        }
      })
      .catch(err => {
        this.setState({ savingWifiSettings: false, error: 'Error saving Wi-Fi settings: ' + (err.message || err) });
      });
  };

  handleAdapterChange = (event) => {
    const selectedValue = event.target.value;
    const selectedDevice = this.state.netDevice.find(dev => dev.value === selectedValue);

    if (!selectedDevice) return;

    const netConnection = [];
    let activeCon = null;

    if (selectedDevice.type === 'ethernet') {
      this.fetchEthernetAliases();
      this.fetchEthernetServerSettings();
      this.setState({ showIP: true });
      this.state.netConnection.forEach(item => {
        if (item.type === '802-3-ethernet' && (item.attachedIface === '' || item.attachedIface === selectedDevice.value)) {
          let base = item.labelPre;
          if (item.state === selectedDevice.value) {
            item.label = base + ' (Active)';
            activeCon = item;
          } else {
            item.label = base;
          }
          netConnection.push(item);
        }
      });
    } else if (selectedDevice.type === 'wifi') {
      this.fetchWifiSettings();
      this.setState({ showIP: true });
      this.state.netConnection.forEach(item => {
        if (item.type === '802-11-wireless' && (item.attachedIface === '""' || item.attachedIface === '' ||
          item.attachedIface === 'undefined' || item.attachedIface === selectedDevice.value)) {
          let base = item.labelPre;
          if (item.state === selectedDevice.value) {
            item.label = base + ' (Active)';
            activeCon = item;
          } else {
            item.label = base;
          }
          netConnection.push(item);
        }
      });
    } else {
      this.setState({ showIP: true });
      this.state.netConnection.forEach(item => {
        if (item.type === 'tun' && (item.attachedIface === '' || item.attachedIface === selectedDevice.value)) {
          if (item.state === selectedDevice.value) {
            item.label = item.labelPre + ' (Active)';
            activeCon = item;
          } else {
            item.label = item.labelPre;
          }
          netConnection.push(item);
        }
      });
    }

    netConnection.sort((a, b) => {
      const getOrder = (item) => {
        if (item.labelPre === 'Ethernet-Client') return 0;
        if (item.labelPre === 'Ethernet-Server' || item.labelPre === 'WiFiAP') return 2;
        return 1;
      };
      return getOrder(a) - getOrder(b);
    });

    if (activeCon === null && netConnection.length > 0) {
      activeCon = netConnection[0];
    } else if (netConnection.length === 0) {
      this.handleConnectionChange({ target: { value: null } });
      this.setState({
        netDeviceSelected: selectedValue,
        netConnectionFiltered: netConnection,
        netConnectionFilteredSelected: null
      });
      return;
    }

    this.setState({
      netDeviceSelected: selectedValue,
      netConnectionFiltered: netConnection,
      netConnectionFilteredSelected: activeCon.value
    }, () => {
      this.handleConnectionChange({ target: { value: activeCon.value } });
    });
  };

  handleConnectionChange = (event) => {
    const selectedValue = event.target.value;

    if (selectedValue === null || selectedValue === '') {
      this.setState({ showIP: false, netConnectionFilteredSelected: null });
      return;
    }

    const selectedConnection = this.state.netConnectionFiltered.find(con => con.value === selectedValue);
    if (!selectedConnection) return;

    this.setState({
      netConnectionFilteredSelected: selectedValue
    });

    fetch('/api/networkIP', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      },
      body: JSON.stringify({
        conName: selectedValue
      })
    }).then(response => response.json())
      .then(state => this.setState(state, () => {
        this.setState({
          curSettings: {
            ipaddresstype: this.state.netConnectionDetails.DHCP || '',
            ipaddress: this.state.netConnectionDetails.IP || '',
            subnet: this.state.netConnectionDetails.subnet || '',
            wpaType: this.state.netConnectionDetails.wpaType || '',
            password: this.state.netConnectionDetails.password || '',
            ssid: this.state.netConnectionDetails.ssid || '',
            band: this.state.netConnectionDetails.band || '',
            channel: this.state.netConnectionDetails.channel || '',
            mode: this.state.netConnectionDetails.mode || '',
            attachedIface: this.state.netConnectionDetails.attachedIface || '',
            priority: this.state.netConnectionDetails.priority !== undefined ? this.state.netConnectionDetails.priority : ''
          }
        }, () => {
          this.setState({
            netConnectionSimilarIfaces: this.getSameAdapter()
          });
        });
      }));
  };

  getSameAdapter = () => {
    const ret = [];
    const selectedDevice = this.state.netDevice.find(dev => dev.value === this.state.netDeviceSelected);
    if (!selectedDevice) return ret;

    const selType = selectedDevice.type;
    this.state.netDevice.forEach(item => {
      if (item.type === selType) {
        ret.push({ value: item.value, label: item.value });
      }
    });
    return ret;
  };

  handleNetworkSubmit = (event) => {
    event.preventDefault();

    if (!this.state.netConnectionFilteredSelected) return;

    const selectedConnection = this.getSelectedConnection();
    if (selectedConnection) {
      if (selectedConnection.labelPre === 'Ethernet-Server' && this.state.curSettings.ipaddresstype !== 'shared') {
        this.setState({ error: 'Cannot modify IP mode for fallback profile Ethernet-Server' });
        return;
      }
    }

    this.setState({ waiting: true });
    requestApi('/api/networkedit', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      },
      body: JSON.stringify({
        conName: this.state.netConnectionFilteredSelected,
        conSettings: this.state.curSettings
      }, (key, value) => {
        if (value !== '') return value;
      })
    })
      .then(() => {
        this.setState({ waiting: false, infoMessage: 'Network Edited' });
        this.handleStart();
      })
      .catch(error => {
        this.setState({ waiting: false, error: 'Error editing network: ' + error.message });
      });
  };

  deleteConnection = (event) => {
    event.preventDefault();
    const selectedConnection = this.getSelectedConnection();
    if (selectedConnection && (selectedConnection.labelPre === 'Ethernet-Server' || selectedConnection.labelPre === 'Ethernet-Client' || selectedConnection.labelPre === 'WiFiAP')) {
      this.setState({ error: 'Cannot delete system profile ' + selectedConnection.labelPre });
      return;
    }
    this.setState({ showModalDelete: true });
  };

  openAddModal = () => {
    const selectedDevice = this.state.netDevice.find(dev => dev.value === this.state.netDeviceSelected);
    const isWifi = selectedDevice && selectedDevice.type === 'wifi';

    if (isWifi) {
      this.setState({ waiting: true });
      fetch(`/api/wifiscan`, { headers: { Authorization: `Bearer ${this.state.token}` } })
        .then(response => response.json())
        .then(state => {
          this.setState({
            ...state,
            waiting: false,
            newConModal: {
              show: true,
              conType: 'wifi',
              step: 'select',
              conName: '',
              mode: 'infrastructure',
              ssid: '',
              wpaType: 'wpa-psk',
              password: '',
              showPW: false,
              ipaddresstype: 'auto',
              ipaddress: '',
              subnet: '',
              band: 'bg',
              channel: '0',
              priority: 100
            }
          });
        })
        .catch(() => {
          this.setState({
            waiting: false,
            newConModal: {
              show: true,
              conType: 'wifi',
              step: 'select',
              conName: '',
              mode: 'infrastructure',
              ssid: '',
              wpaType: 'wpa-psk',
              password: '',
              showPW: false,
              ipaddresstype: 'auto',
              ipaddress: '',
              subnet: '',
              band: 'bg',
              channel: '0',
              priority: 100
            }
          });
        });
    } else {
      this.setState({
        newConModal: {
          show: true,
          conType: selectedDevice ? selectedDevice.type : 'ethernet',
          step: 'configure',
          conName: 'Ethernet-Custom',
          mode: '',
          ssid: '',
          wpaType: 'none',
          password: '',
          showPW: false,
          ipaddresstype: 'auto',
          ipaddress: '',
          subnet: '',
          band: '',
          channel: '0',
          priority: 100
        }
      });
    }
  };

  closeNewConModal = () => {
    this.setState(prev => ({
      newConModal: { ...prev.newConModal, show: false }
    }));
  };

  selectScannedWifi = (ssid, security) => {
    this.setState(prev => ({
      newConModal: {
        ...prev.newConModal,
        step: 'configure',
        mode: 'infrastructure',
        ssid: ssid || '',
        conName: ssid || 'WiFi-Client',
        wpaType: security === '' ? 'none' : 'wpa-psk',
        password: '',
        ipaddresstype: 'auto',
        priority: 100
      }
    }));
  };

  selectCreateHotspot = () => {
    this.setState(prev => ({
      newConModal: {
        ...prev.newConModal,
        step: 'configure',
        mode: 'ap',
        conName: 'WiFiAP',
        ssid: 'rpanion',
        band: 'bg',
        channel: '0',
        wpaType: 'wpa-psk',
        password: '',
        ipaddresstype: 'shared',
        ipaddress: '10.0.2.100',
        subnet: '255.255.255.0',
        priority: 0
      }
    }));
  };

  selectManualWifi = () => {
    this.setState(prev => ({
      newConModal: {
        ...prev.newConModal,
        step: 'configure',
        mode: 'infrastructure',
        conName: 'WiFi-Client',
        ssid: '',
        wpaType: 'wpa-psk',
        password: '',
        ipaddresstype: 'auto',
        priority: 100
      }
    }));
  };

  selectHiddenWifi = () => {
    this.selectManualWifi();
  };

  newConChangeHandler = event => {
    const name = event.target.name;
    const value = event.target.value;

    this.setState(prev => {
      const updated = { ...prev.newConModal, [name]: value };
      if (name === 'ipaddresstype') {
        if (value === 'shared') {
          updated.ipaddress = updated.ipaddress || '10.0.3.1';
          updated.subnet = updated.subnet || '255.255.255.0';
          if (updated.priority === 100) updated.priority = 50;
        } else if (value === 'auto') {
          if (updated.priority === 50) updated.priority = 100;
        }
      }
      return { newConModal: updated };
    });
  };

  newConTogglePassword = event => {
    const checked = event.target.checked;
    this.setState(prev => ({
      newConModal: { ...prev.newConModal, showPW: checked }
    }));
  };

  submitNewConnection = (event) => {
    if (event) event.preventDefault();

    const modal = this.state.newConModal;
    const conName = (modal.conName || '').trim();

    if (!conName) {
      this.setState({ error: 'Connection name cannot be empty' });
      return;
    }

    if (modal.mode === 'infrastructure' && !modal.ssid.trim()) {
      this.setState({ error: 'SSID cannot be empty' });
      return;
    }

    if (modal.wpaType !== 'none' && (modal.mode === 'infrastructure' || modal.mode === 'ap')) {
      const pwLen = (modal.password || '').length;
      if (pwLen < 8 || pwLen > 63) {
        this.setState({ error: 'Password must be between 8 and 63 characters long' });
        return;
      }
    }

    if (modal.ipaddresstype !== 'auto') {
      if (!modal.ipaddress || !modal.subnet) {
        this.setState({ error: 'IP Address and Subnet Mask are required' });
        return;
      }
    }

    const selectedDevice = this.state.netDevice.find(dev => dev.value === this.state.netDeviceSelected);
    const sameAdapters = this.getSameAdapter();
    const defaultAttachedIface = sameAdapters.length > 0 ? sameAdapters[0].value : this.state.netDeviceSelected;

    const conSettings = {
      ipaddresstype: modal.ipaddresstype,
      ipaddress: modal.ipaddress,
      subnet: modal.subnet,
      wpaType: modal.wpaType,
      password: modal.password,
      ssid: modal.ssid,
      band: modal.band,
      channel: modal.channel,
      mode: modal.mode,
      attachedIface: defaultAttachedIface,
      priority: modal.priority
    };

    this.setState({ waiting: true });

    requestApi('/api/networkadd', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      },
      body: JSON.stringify({
        conSettings: conSettings,
        conName: conName,
        conType: selectedDevice ? selectedDevice.type : '',
        conAdapter: this.state.netDeviceSelected
      }, (key, value) => {
        if (value !== '') return value;
      })
    })
      .then(() => {
        this.setState(prev => ({
          waiting: false,
          infoMessage: 'Network Added',
          newConModal: { ...prev.newConModal, show: false }
        }));
        this.handleStart();
      })
      .catch(error => {
        this.setState({ waiting: false, error: 'Error adding network: ' + error.message });
      });
  };

  activateConnection = (event) => {
    event.preventDefault();

    if (this.state.netConnectionFilteredSelected) {
      this.setState({ waiting: true }, () => {
        requestApi('/api/networkactivate', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.state.token}`
          },
          body: JSON.stringify({
            conName: this.state.netConnectionFilteredSelected
          })
        })
          .then(() => {
            this.setState({ waiting: false, infoMessage: 'Network Activated' });
            this.handleStart();
          })
          .catch(error => {
            this.setState({ waiting: false, error: 'Error activating network: ' + error.message });
          });
      });
    }
  };

  promptDeactivateConnection = (event) => {
    event.preventDefault();
    const selectedConnection = this.getSelectedConnection();
    if (selectedConnection && (selectedConnection.labelPre === 'Ethernet-Server' || selectedConnection.labelPre === 'WiFiAP')) {
      this.setState({ error: 'Cannot deactivate fallback profile ' + selectedConnection.labelPre });
      return;
    }
    this.setState({ showModalDeactivate: true });
  };

  handleCloseModalDeactivate = () => {
    this.setState({ showModalDeactivate: false });
  };

  confirmDeactivateConnection = () => {
    this.setState({ showModalDeactivate: false });
    this.deactivateConnection();
  };

  deactivateConnection = () => {
    if (this.state.netConnectionFilteredSelected) {
      this.setState({ waiting: true }, () => {
        requestApi('/api/networkdeactivate', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.state.token}`
          },
          body: JSON.stringify({
            conName: this.state.netConnectionFilteredSelected
          })
        })
          .then(() => {
            this.setState({ waiting: false, infoMessage: 'Network Deactivated' });
            this.handleStart();
          })
          .catch(error => {
            this.setState({ waiting: false, error: 'Error deactivating network: ' + error.message });
          });
      });
    }
  };

  changeHandler = event => {
    const name = event.target.name;
    const value = event.target.value;

    if (name === 'ipaddresstype' && value === 'shared') {
      this.setState({
        curSettings: {
          ...this.state.curSettings,
          ipaddresstype: value,
          ipaddress: this.state.curSettings.ipaddress || '10.0.3.1',
          subnet: this.state.curSettings.subnet || '255.255.255.0'
        }
      });
    } else if (name === 'band') {
      this.setState({
        curSettings: {
          ...this.state.curSettings,
          [name]: value,
          channel: '0'
        }
      });
    } else {
      this.setState({
        curSettings: {
          ...this.state.curSettings,
          [name]: value
        }
      });
    }
  };

  togglePasswordVisible = event => {
    this.setState({ showPW: event.target.checked });
  };

  resetForm = () => {
    this.setState({
      curSettings: {
        ipaddresstype: this.state.netConnectionDetails.DHCP || '',
        ipaddress: this.state.netConnectionDetails.IP || '',
        subnet: this.state.netConnectionDetails.subnet || '',
        wpaType: this.state.netConnectionDetails.wpaType || '',
        password: this.state.netConnectionDetails.password || '',
        ssid: this.state.netConnectionDetails.ssid || '',
        band: this.state.netConnectionDetails.band || '',
        channel: this.state.netConnectionDetails.channel || '',
        mode: this.state.netConnectionDetails.mode || '',
        attachedIface: this.state.netConnectionDetails.attachedIface || '',
        priority: this.state.netConnectionDetails.priority !== undefined ? this.state.netConnectionDetails.priority : ''
      }
    });
  };

  renderTitle() {
    return 'Network Configuration';
  }

  handleCloseModalDelete = () => {
    this.setState({ showModalDelete: false });
  };

  handleDelete = () => {
    this.setState({ showModalDelete: false });

    const selectedConnection = this.getSelectedConnection();
    if (selectedConnection && (selectedConnection.labelPre === 'Ethernet-Server' || selectedConnection.labelPre === 'Ethernet-Client' || selectedConnection.labelPre === 'WiFiAP')) {
      this.setState({ error: 'Cannot delete system profile ' + selectedConnection.labelPre });
      return;
    }

    if (!this.state.netConnectionFilteredSelected) return;

    this.setState({ waiting: true }, () => {
      requestApi('/api/networkdelete', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.token}`
        },
        body: JSON.stringify({
          conName: this.state.netConnectionFilteredSelected
        })
      })
        .then(() => {
          this.setState({ waiting: false, infoMessage: 'Network Deleted' });
          setTimeout(() => {
            this.handleStart();
          }, 500);
        })
        .catch(error => {
          this.setState({ waiting: false, error: 'Error deleting network: ' + error.message });
        });
    });
  };

  refreshWifi = () => {
    this.setState({ waiting: true }, () => {
      fetch(`/api/wifiscan`, { headers: { Authorization: `Bearer ${this.state.token}` } })
        .then(response => response.json())
        .then(state => this.setState({ ...state, waiting: false }))
        .catch(() => this.setState({ waiting: false }));
    });
  };

  refreshConList = () => {
    this.refreshAll();
  };

  refreshInfoList = () => {
    if (this.state.netConnectionFilteredSelected) {
      this.handleConnectionChange({ target: { value: this.state.netConnectionFilteredSelected } });
    }
  };

  refreshAll = () => {
    this.setState({ waiting: true }, () => {
      Promise.all([
        fetch(`/api/networkconnections`, { headers: { Authorization: `Bearer ${this.state.token}` } }).then(res => res.json()),
        fetch(`/api/wirelessstatus`, { headers: { Authorization: `Bearer ${this.state.token}` } }).then(res => res.json())
      ]).then(([connState, wifiState]) => {
        this.setState({ ...connState, ...wifiState }, () => {
          this.handleAdapterChange({ target: { value: this.state.netDeviceSelected } });
          this.fetchEthernetAliases();
          this.fetchEthernetServerSettings();
          this.fetchWifiSettings();
          this.setState({ waiting: false });
        });
      }).catch(err => {
        this.setState({ waiting: false, error: 'Error refreshing network list: ' + err });
      });
    });
  };

  handleWifiCheckboxChange = (event) => {
    const checked = event.target.checked;
    if (!checked) {
      this.setState({ showModalDisableWifi: true });
    } else {
      this.setWirelessStatus(true);
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
    this.setState({ waiting: true }, () => {
      requestApi('/api/setwirelessstatus', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.token}`
        },
        body: JSON.stringify({
          status: value
        })
      })
        .then(status => {
          this.setState({ waiting: false, ...status });
          this.handleStart();
        })
        .catch(error => {
          this.setState({ waiting: false, error: 'Error toggling wireless: ' + error.message });
        });
    });
  };

  getValidChannels() {
    const selectedDevice = this.state.netDevice.find(dev => dev.value === this.state.netDeviceSelected);
    if (!selectedDevice || !selectedDevice.channels) return [];

    const opt = [];
    for (let i = 0, len = selectedDevice.channels.length; i < len; i++) {
      if (selectedDevice.channels[i].band === this.state.curSettings.band || selectedDevice.channels[i].band === 0) {
        opt.push(selectedDevice.channels[i]);
      }
    }
    return opt;
  }

  getValidChannelsForModal() {
    const selectedDevice = this.state.netDevice.find(dev => dev.value === this.state.netDeviceSelected);
    if (!selectedDevice || !selectedDevice.channels) return [];

    const opt = [];
    for (let i = 0, len = selectedDevice.channels.length; i < len; i++) {
      if (selectedDevice.channels[i].band === this.state.newConModal.band || selectedDevice.channels[i].band === 0) {
        opt.push(selectedDevice.channels[i]);
      }
    }
    return opt;
  }

  getSelectedDevice() {
    return this.state.netDevice.find(dev => dev.value === this.state.netDeviceSelected);
  }

  getSelectedConnection() {
    return this.state.netConnectionFiltered.find(con => con.value === this.state.netConnectionFilteredSelected);
  }

  renderContent() {
    const selectedDevice = this.getSelectedDevice();
    const selectedConnection = this.getSelectedConnection();
    const isConnected = Boolean(selectedConnection && selectedConnection.state !== '');
    const wifiDisabled = Boolean(selectedDevice && selectedDevice.type === 'wifi' && !this.state.wirelessEnabled);
    const isBackupProfile = Boolean(selectedConnection && (selectedConnection.labelPre === 'Ethernet-Server' || selectedConnection.labelPre === 'WiFiAP'));
    const isClientDefault = Boolean(selectedConnection && selectedConnection.labelPre === 'Ethernet-Client');
    const isSystemProfile = Boolean(selectedConnection && (selectedConnection.labelPre === 'Ethernet-Server' || selectedConnection.labelPre === 'WiFiAP' || selectedConnection.labelPre === 'Ethernet-Client'));
    const isEthernetServer = Boolean(selectedConnection && selectedConnection.labelPre === 'Ethernet-Server');
    const isEthernet = Boolean(selectedDevice && selectedDevice.type === 'ethernet');

    const activeEthConnection = this.state.netConnection.find(
      c => c.type === '802-3-ethernet' && (c.state === (selectedDevice ? selectedDevice.value : 'eth0'))
    );
    const isClientActive = Boolean(activeEthConnection && activeEthConnection.labelPre === 'Ethernet-Client');
    const isServerActive = Boolean(activeEthConnection && activeEthConnection.labelPre === 'Ethernet-Server');
    const isStaticActive = Boolean(this.state.ethAliases && this.state.ethAliases.some(a => a.active));
    const currentEthConn = this.state.ethSelectedConnection || (isServerActive ? 'server' : 'client');

    const userConnections = this.state.netConnectionFiltered.filter(c => c.labelPre !== 'WiFiAP' && c.labelPre !== 'Ethernet-Server' && c.labelPre !== 'Ethernet-Client');
    const systemConnections = this.state.netConnectionFiltered.filter(c => c.labelPre === 'WiFiAP' || c.labelPre === 'Ethernet-Server' || c.labelPre === 'Ethernet-Client');

    return (
      <div style={{ maxWidth: 760, width: '100%' }}>
        <p><i>Create, view, edit and delete network connections</i></p>
        <h2>Select Connection</h2>
        <p><i>Show a specific network connection, filtered by network adapter</i></p>

        <div className="form-group row" style={{ marginBottom: '10px' }}>
          <label className="col-sm-4 col-form-label">Adapter</label>
          <div className="col-sm-8">
            <Form.Select onChange={this.handleAdapterChange} value={this.state.netDeviceSelected || ''}>
              {this.state.netDevice.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Form.Select>
          </div>
        </div>

        <div className="form-group row" style={{ marginBottom: '10px' }}>
          <label className="col-sm-4 col-form-label">Connection</label>
          <div className="col-sm-8 d-flex align-items-center">
            {isEthernet ? (
              <>
                <Form.Select
                  value={currentEthConn}
                  onChange={(e) => this.setState({ ethSelectedConnection: e.target.value })}
                >
                  <option value="server">{isServerActive ? 'DHCP Server (Active)' : 'DHCP Server'}</option>
                  <option value="client">{isClientActive ? 'DHCP Client (Active)' : 'DHCP Client'}</option>
                  <option value="static">{isStaticActive ? 'Static IP (Active)' : 'Static IP'}</option>
                </Form.Select>
                {currentEthConn === 'server' && (
                  isServerActive ? (
                    <span className="badge bg-success ms-2">Active</span>
                  ) : (
                    <span className="badge bg-secondary ms-2">Inactive</span>
                  )
                )}
                {currentEthConn === 'client' && (
                  isClientActive ? (
                    <span className="badge bg-success ms-2">Active</span>
                  ) : (
                    <span className="badge bg-secondary ms-2">Inactive</span>
                  )
                )}
                {currentEthConn === 'static' && (
                  isStaticActive ? (
                    <span className="badge bg-success ms-2">Active</span>
                  ) : (
                    <span className="badge bg-secondary ms-2">Inactive</span>
                  )
                )}
              </>
            ) : (
              <>
                <Form.Select onChange={this.handleConnectionChange} value={this.state.netConnectionFilteredSelected || ''}>
                  {userConnections.length > 0 && (
                    <optgroup label={selectedDevice && selectedDevice.type === 'wifi' ? 'Saved Wi-Fi Networks' : 'Custom Connections'}>
                      {userConnections.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </optgroup>
                  )}
                  {systemConnections.length > 0 && (
                    <optgroup label="System & Fallback Profiles" style={{ color: '#6c757d' }}>
                      {systemConnections.map(option => {
                        const isFallback = option.labelPre === 'WiFiAP' || option.labelPre === 'Ethernet-Server';
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
                {isBackupProfile && (
                  <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle ms-1">Fallback</span>
                )}
                {isClientDefault && (
                  <span className="badge bg-light text-secondary border ms-1">System Default</span>
                )}
              </>
            )}
          </div>
        </div>

        {isEthernet ? (
          <EthernetConfigSection
            currentEthConn={currentEthConn}
            ethServerSettings={this.state.ethServerSettings}
            ethServerSaving={this.state.ethServerSaving}
            onServerSettingsChange={(field, val) => this.setState(prev => ({
              ethServerSettings: { ...prev.ethServerSettings, [field]: val }
            }))}
            onSaveServer={this.handleSaveEthernetServer}
            ethAliases={this.state.ethAliases}
            newAliasIp={this.state.newAliasIp}
            newAliasSubnet={this.state.newAliasSubnet}
            ethAliasesSaving={this.state.ethAliasesSaving}
            onNewAliasIpChange={(val) => this.setState({ newAliasIp: val })}
            onNewAliasSubnetChange={(val) => this.setState({ newAliasSubnet: val })}
            onAddAlias={this.handleAddAlias}
            onPromptDeleteAlias={this.promptDeleteAlias}
          />
        ) : (
          <div>
            {selectedDevice && selectedDevice.type === 'wifi' && (
              <>
                <div className="form-group row" style={{ marginBottom: '10px' }}>
                  <label className="col-sm-4 col-form-label"></label>
                  <div className="col-sm-8">
                    <Form.Check
                      type="checkbox"
                      label="Wifi interfaces enabled"
                      checked={this.state.wirelessEnabled}
                      onChange={this.handleWifiCheckboxChange}
                    />
                  </div>
                </div>

                <div className="form-group row" style={{ marginBottom: '15px' }}>
                  <label className="col-sm-4 col-form-label">AP Fallback Mode</label>
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
            )}

            <div className="form-group row" style={{ marginBottom: '15px' }}>
              <label className="col-sm-4 col-form-label">Actions</label>
              <div className="col-sm-8 d-flex flex-wrap gap-2">
                {isConnected ? (
                  <Button
                    size="sm"
                    variant="warning"
                    onClick={this.promptDeactivateConnection}
                    disabled={wifiDisabled || isBackupProfile}
                    className="deactivateConnection"
                    title={isBackupProfile ? 'Fallback connection cannot be deactivated manually' : 'Deactivate'}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="success"
                    onClick={this.activateConnection}
                    disabled={!selectedConnection || wifiDisabled}
                    className="activateConnection"
                  >
                    Activate
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="primary"
                  onClick={this.openAddModal}
                  disabled={(selectedConnection && selectedConnection.type === 'tun') || wifiDisabled}
                  className="addConnection"
                >
                  + Add Connection
                </Button>
                <Button
                  size="sm"
                  variant="outline-danger"
                  onClick={this.deleteConnection}
                  disabled={!selectedConnection || isSystemProfile || selectedConnection.type === 'tun'}
                  className="deleteConnection"
                  title={isSystemProfile ? 'System profile cannot be deleted' : 'Delete'}
                >
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={this.refreshAll}
                  disabled={selectedConnection && selectedConnection.type === 'tun'}
                >
                  Refresh
                </Button>
              </div>
            </div>

            {selectedConnection && (
              <Accordion className="mt-4" defaultActiveKey={null}>
                <Accordion.Item eventKey="0">
                  <Accordion.Header>
                    Edit Connection: <strong className="ms-1">{selectedConnection.labelPre}</strong>
                    {isBackupProfile && (
                      <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle ms-2">Fallback</span>
                    )}
                    {isClientDefault && (
                      <span className="badge bg-light text-secondary border ms-2">System Default</span>
                    )}
                  </Accordion.Header>
                  <Accordion.Body>
                    <Form onSubmit={this.handleNetworkSubmit}>
                      <fieldset disabled={wifiDisabled}>
                        <div className="ipconfig" style={{ display: (this.state.showIP && this.state.curSettings.mode !== 'adhoc' && this.state.curSettings.mode !== 'ap') ? 'block' : 'none' }}>
                          <h3>IP Address</h3>

                          <div className="form-group row" style={{ marginBottom: '5px' }}>
                            <label className="col-sm-4 col-form-label">IP Address Type</label>
                            <div className="col-sm-8">
                              <div className="form-check">
                                <input
                                  className="form-check-input"
                                  type="radio"
                                  name="ipaddresstype"
                                  value="auto"
                                  onChange={this.changeHandler}
                                  checked={this.state.curSettings.ipaddresstype === 'auto'}
                                  disabled={isEthernetServer}
                                />
                                <label className="form-check-label">DHCP Client</label>
                              </div>
                              <div className="form-check">
                                <input
                                  className="form-check-input"
                                  type="radio"
                                  name="ipaddresstype"
                                  value="manual"
                                  onChange={this.changeHandler}
                                  checked={this.state.curSettings.ipaddresstype === 'manual'}
                                  disabled={isEthernetServer || isClientDefault}
                                />
                                <label className="form-check-label">Static IP</label>
                              </div>
                              <div className="form-check">
                                <input
                                  className="form-check-input"
                                  type="radio"
                                  name="ipaddresstype"
                                  value="shared"
                                  onChange={this.changeHandler}
                                  checked={this.state.curSettings.ipaddresstype === 'shared'}
                                  disabled={isClientDefault}
                                />
                                <label className="form-check-label">DHCP Server</label>
                              </div>
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
                            </div>
                          </div>

                          <div style={{ display: (this.state.curSettings.ipaddresstype !== 'auto') ? 'block' : 'none' }}>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                              <label className="col-sm-4 col-form-label">{this.state.curSettings.ipaddresstype === 'shared' ? 'Gateway IP' : 'IP Address'}</label>
                              <div className="col-sm-8">
                                <IPAddressInput
                                  name="ipaddress"
                                  value={this.state.curSettings.ipaddress || ''}
                                  onChange={this.changeHandler}
                                  disabled={this.state.curSettings.ipaddresstype === 'auto'}
                                />
                              </div>
                            </div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                              <label className="col-sm-4 col-form-label">Subnet Mask</label>
                              <div className="col-sm-8">
                                <IPAddressInput
                                  name="subnet"
                                  value={this.state.curSettings.subnet || ''}
                                  onChange={this.changeHandler}
                                  disabled={this.state.curSettings.ipaddresstype === 'auto'}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="wificlientconfig" style={{ display: this.state.curSettings.mode === 'infrastructure' ? 'block' : 'none' }}>
                          <h3>Wifi Client</h3>
                          <div className="form-group row" style={{ marginBottom: '5px' }}>
                            <label className="col-sm-4 col-form-label">SSID Name</label>
                            <div className="col-sm-8">
                              <Form.Control name="ssid" onChange={this.changeHandler} value={this.state.curSettings.ssid} type="text" />
                            </div>
                          </div>
                          <div className="form-group row" style={{ marginBottom: '5px' }}>
                            <label className="col-sm-4 col-form-label">Security</label>
                            <div className="col-sm-8">
                              <Form.Select name="wpaType" value={this.state.curSettings.wpaType} onChange={this.changeHandler}>
                                {this.state.wpaTypes.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </Form.Select>
                            </div>
                          </div>
                          <div style={{ display: (this.state.curSettings.wpaType !== 'none') ? 'block' : 'none' }}>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                              <label className="col-sm-4 col-form-label">Password</label>
                              <div className="col-sm-8">
                                <Form.Control
                                  name="password"
                                  type={this.state.showPW === true ? 'text' : 'password'}
                                  disabled={this.state.curSettings.wpaType === 'none'}
                                  value={this.state.curSettings.wpaType === 'none' ? '' : this.state.curSettings.password}
                                  onChange={this.changeHandler}
                                  isInvalid={
                                    this.state.curSettings.wpaType !== 'none' &&
                                    ((this.state.curSettings.password || '').length < 8 || (this.state.curSettings.password || '').length > 63)
                                  }
                                />
                                <Form.Control.Feedback type="invalid">
                                  Password must be between 8 and 63 characters long.
                                </Form.Control.Feedback><br />
                                <Form.Check
                                  type="checkbox"
                                  name="showpassword"
                                  label="Show Password"
                                  checked={this.state.showPW}
                                  disabled={this.state.curSettings.wpaType === 'none'}
                                  onChange={this.togglePasswordVisible}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="wifiapconfig" style={{ display: (this.state.curSettings.mode === 'ap' || this.state.curSettings.mode === 'adhoc') ? 'block' : 'none' }}>
                          <h3>Wifi Access Point</h3>
                          <div className="form-group row" style={{ marginBottom: '5px' }}>
                            <label className="col-sm-4 col-form-label">SSID Name</label>
                            <div className="col-sm-8">
                              <Form.Control name="ssid" onChange={this.changeHandler} value={this.state.curSettings.ssid} type="text" />
                            </div>
                          </div>

                          <div className="form-group row" style={{ marginBottom: '5px' }}>
                            <label className="col-sm-4 col-form-label">Band</label>
                            <div className="col-sm-8">
                              <Form.Select name="band" onChange={this.changeHandler} value={this.state.curSettings.band}>
                                {this.state.bandTypes.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </Form.Select>
                            </div>
                          </div>
                          <div className="form-group row" style={{ marginBottom: '5px' }}>
                            <label className="col-sm-4 col-form-label">Channel</label>
                            <div className="col-sm-8">
                              <Form.Select name="channel" onChange={this.changeHandler} value={this.state.curSettings.channel}>
                                {this.getValidChannels().map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </Form.Select>
                            </div>
                          </div>

                          <div className="form-group row" style={{ marginBottom: '5px' }}>
                            <label className="col-sm-4 col-form-label">Security</label>
                            <div className="col-sm-8">
                              <Form.Select name="wpaType" value={this.state.curSettings.wpaType} onChange={this.changeHandler}>
                                {this.state.wpaTypes.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </Form.Select>
                            </div>
                          </div>

                          <div className="form-group row" style={{ marginBottom: '5px' }}>
                            <label className="col-sm-4 col-form-label">Password</label>
                            <div className="col-sm-8">
                              <Form.Control
                                name="password"
                                type={this.state.showPW === true ? 'text' : 'password'}
                                disabled={this.state.curSettings.wpaType === 'none'}
                                value={this.state.curSettings.wpaType === 'none' ? '' : this.state.curSettings.password}
                                onChange={this.changeHandler}
                                isInvalid={
                                  this.state.curSettings.wpaType !== 'none' &&
                                  ((this.state.curSettings.password || '').length < 8 || (this.state.curSettings.password || '').length > 63)
                                }
                              />
                              <Form.Control.Feedback type="invalid">
                                Password must be between 8 and 63 characters long.
                              </Form.Control.Feedback><br />
                              <Form.Check
                                type="checkbox"
                                name="showpassword"
                                label="Show Password"
                                checked={this.state.showPW}
                                disabled={this.state.curSettings.wpaType === 'none'}
                                onChange={this.togglePasswordVisible}
                              />
                            </div>
                          </div>

                          <div className="form-group row" style={{ marginBottom: '5px' }}>
                            <label className="col-sm-4 col-form-label">Starting IP Address</label>
                            <div className="col-sm-8">
                              <IPAddressInput
                                name="ipaddress"
                                value={this.state.curSettings.ipaddress || ''}
                                onChange={this.changeHandler}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="priorityconfig" style={{ display: this.state.showIP ? 'block' : 'none' }}>
                          <h3>Connection Priority</h3>
                          <div className="form-group row" style={{ marginBottom: '15px' }}>
                            <label className="col-sm-4 col-form-label">Priority</label>
                            <div className="col-sm-8">
                              <Form.Control
                                name="priority"
                                type="number"
                                onChange={this.changeHandler}
                                value={this.state.curSettings.priority !== undefined ? this.state.curSettings.priority : ''}
                              />
                              <Form.Text className="text-muted">
                                Higher priority connections are attempted first.
                              </Form.Text>
                            </div>
                          </div>
                        </div>

                        <div className="form-group row" style={{ marginBottom: '5px' }}>
                          <label className="col-sm-4 col-form-label"></label>
                          <div className="col-sm-8">
                            <Button size="sm" variant="primary" type="submit" disabled={selectedConnection && selectedConnection.type === 'tun'}>Save Changes</Button>{' '}
                            <Button size="sm" variant="secondary" onClick={this.resetForm}>Discard Changes</Button>
                          </div>
                        </div>
                      </fieldset>
                    </Form>
                  </Accordion.Body>
                </Accordion.Item>
              </Accordion>
            )}
          </div>
        )}

        <NewConnectionModal
          modal={this.state.newConModal}
          onClose={this.closeNewConModal}
          detWifi={this.state.detWifi}
          wpaTypes={this.state.wpaTypes}
          bandTypes={this.state.bandTypes}
          validChannels={this.getValidChannelsForModal()}
          onChange={this.newConChangeHandler}
          onTogglePassword={this.newConTogglePassword}
          onSelectScannedWifi={this.selectScannedWifi}
          onSelectCreateHotspot={this.selectCreateHotspot}
          onSelectManualWifi={this.selectManualWifi}
          onRefreshWifi={this.refreshWifi}
          onBack={() => this.setState(prev => ({ newConModal: { ...prev.newConModal, step: 'select' } }))}
          onSubmit={this.submitNewConnection}
        />

        <Modal show={this.state.showModalDelete} onHide={this.handleCloseModalDelete}>
          <Modal.Header closeButton>
            <Modal.Title>Confirm Delete</Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <p>Are you sure you want to delete the network connection &apos;{selectedConnection ? (selectedConnection.labelPre || selectedConnection.label) : ''}&apos;?</p>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="danger" onClick={this.handleDelete}>Delete</Button>
            <Button variant="secondary" onClick={this.handleCloseModalDelete}>Cancel</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={this.state.showModalDeleteAlias} onHide={this.handleCloseModalDeleteAlias}>
          <Modal.Header closeButton>
            <Modal.Title>Confirm Delete</Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <p>Are you sure you want to delete static IP alias &apos;{this.state.aliasToDelete ? this.state.aliasToDelete.ip : ''}&apos;?</p>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="danger" onClick={this.confirmDeleteAlias} disabled={this.state.ethAliasesSaving}>
              {this.state.ethAliasesSaving ? 'Deleting...' : 'Delete'}
            </Button>
            <Button variant="secondary" onClick={this.handleCloseModalDeleteAlias} disabled={this.state.ethAliasesSaving}>
              Cancel
            </Button>
          </Modal.Footer>
        </Modal>

        <Modal show={this.state.showModalDeactivate} onHide={this.handleCloseModalDeactivate}>
          <Modal.Header closeButton>
            <Modal.Title>Confirm Deactivation</Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <p>Are you sure you want to deactivate &apos;{selectedConnection ? (selectedConnection.labelPre || selectedConnection.label) : ''}&apos;? If you are currently connected through this network, your session may disconnect.</p>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="warning" onClick={this.confirmDeactivateConnection}>Deactivate</Button>
            <Button variant="secondary" onClick={this.handleCloseModalDeactivate}>Cancel</Button>
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
