// Pure helpers for the network configuration page. Connection objects come
// from /api/networkconnections: { value: uuid, labelPre, type, state, attachedIface, role }.

export const WPA_TYPES = [{ value: 'none', label: 'None' }, { value: 'wpa-psk', label: 'WPA (PSK)' }];
export const BAND_TYPES = [{ value: 'a', label: '5 GHz' }, { value: 'bg', label: '2.4 GHz' }];
export const DEFAULT_SUBNET = '255.255.255.0';
export const DEFAULT_SERVER_IP = '10.0.3.1';
export const DEFAULT_AP_IP = '10.0.2.100';
export const DEFAULT_PRIORITY = 100;
export const SERVER_PRIORITY = 50;

export const ROLE = {
  ETH_CLIENT: 'ethernet-client',
  ETH_SERVER: 'ethernet-server',
  WIFI_AP: 'wifi-ap'
};

const NM_TYPE_FOR_DEVICE = {
  ethernet: '802-3-ethernet',
  wifi: '802-11-wireless'
};

// nmcli reports an unbound interface-name in several forms
const UNBOUND_IFACE = ['', '""', 'undefined'];

function sortOrder(con) {
  if (con.role === ROLE.ETH_CLIENT) return 0;
  if (con.role === ROLE.ETH_SERVER || con.role === ROLE.WIFI_AP) return 2;
  return 1;
}

export function filterConnectionsForDevice(connections, device) {
  if (!device || !Array.isArray(connections)) return [];
  const nmType = NM_TYPE_FOR_DEVICE[device.type] || 'tun';
  return connections
    .filter(item => item.type === nmType &&
      (!item.attachedIface || UNBOUND_IFACE.includes(item.attachedIface) || item.attachedIface === device.value))
    .map(item => {
      const isActive = item.state === device.value;
      return { ...item, label: isActive ? `${item.labelPre} (Active)` : item.labelPre, isActive };
    })
    .sort((a, b) => sortOrder(a) - sortOrder(b));
}

// Keeps the current selection while it exists, otherwise the active profile, otherwise the first
export function resolveSelectedConnection(filtered, uuid) {
  if (!filtered || filtered.length === 0) return null;
  return filtered.find(c => c.value === uuid) || filtered.find(c => c.isActive) || filtered[0];
}

// Keeps the current adapter while it exists, otherwise the first Wi-Fi adapter, otherwise the first
export function pickDefaultDevice(devices, current) {
  if (!Array.isArray(devices) || devices.length === 0) return null;
  if (current && devices.some(dev => dev.value === current)) return current;
  const wifi = devices.find(dev => dev.type === 'wifi');
  return (wifi || devices[0]).value;
}

export function toFormSettings(details) {
  const d = details || {};
  return {
    ipaddresstype: d.DHCP || '',
    ipaddress: d.IP || '',
    subnet: d.subnet || '',
    wpaType: d.wpaType || '',
    password: d.password || '',
    ssid: d.ssid || '',
    band: d.band || '',
    channel: d.channel || '',
    mode: d.mode || '',
    attachedIface: d.attachedIface || '',
    priority: d.priority !== undefined ? d.priority : ''
  };
}

// Channels with band 0 apply to every band (e.g. "Auto")
export function channelsForBand(device, band) {
  if (!device || !Array.isArray(device.channels)) return [];
  return device.channels.filter(ch => ch.band === band || ch.band === 0);
}

export function makeNewConModal(type) {
  if (type === 'wifi') {
    return {
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
      priority: DEFAULT_PRIORITY
    };
  }
  return {
    conType: type || 'ethernet',
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
    priority: DEFAULT_PRIORITY
  };
}

export function toPriority(value) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value);
  return Number.isFinite(num) ? num : '';
}

export function applyNewConChange(draft, name, value) {
  const updated = { ...draft, [name]: name === 'priority' ? toPriority(value) : value };
  if (name === 'ipaddresstype') {
    if (value === 'shared') {
      updated.ipaddress = updated.ipaddress || DEFAULT_SERVER_IP;
      updated.subnet = updated.subnet || DEFAULT_SUBNET;
      if (updated.priority === DEFAULT_PRIORITY) updated.priority = SERVER_PRIORITY;
    } else if (value === 'auto' && updated.priority === SERVER_PRIORITY) {
      updated.priority = DEFAULT_PRIORITY;
    }
  }
  return updated;
}

export function applyScannedWifi(draft, ssid, security) {
  return {
    ...draft,
    step: 'configure',
    mode: 'infrastructure',
    ssid: ssid || '',
    conName: ssid || 'WiFi-Client',
    wpaType: !security || security === 'Open' ? 'none' : 'wpa-psk',
    password: '',
    ipaddresstype: 'auto',
    priority: DEFAULT_PRIORITY
  };
}

export function applyHotspot(draft) {
  return {
    ...draft,
    step: 'configure',
    mode: 'ap',
    conName: 'WiFiAP',
    ssid: 'rpanion',
    band: 'bg',
    channel: '0',
    wpaType: 'wpa-psk',
    password: '',
    ipaddresstype: 'shared',
    ipaddress: DEFAULT_AP_IP,
    subnet: DEFAULT_SUBNET,
    priority: 0
  };
}

export function applyManualWifi(draft) {
  return {
    ...draft,
    step: 'configure',
    mode: 'infrastructure',
    conName: 'WiFi-Client',
    ssid: '',
    wpaType: 'wpa-psk',
    password: '',
    ipaddresstype: 'auto',
    priority: DEFAULT_PRIORITY
  };
}

export function isPasswordLengthValid(password) {
  const len = (password || '').length;
  return len >= 8 && len <= 63;
}

// Returns an error message, or null when the draft can be submitted
export function validateNewConnection(draft) {
  if (!(draft.conName || '').trim()) return 'Connection name cannot be empty';
  if (draft.mode === 'infrastructure' && !(draft.ssid || '').trim()) return 'SSID cannot be empty';
  if (draft.wpaType !== 'none' && (draft.mode === 'infrastructure' || draft.mode === 'ap') &&
    !isPasswordLengthValid(draft.password)) {
    return 'Password must be between 8 and 63 characters long';
  }
  if (draft.ipaddresstype !== 'auto' && (!draft.ipaddress || !draft.subnet)) {
    return 'IP Address and Subnet Mask are required';
  }
  return null;
}

// The server binds the profile to conAdapter, so attachedIface is not sent
export function toNewConSettings(draft) {
  return {
    ipaddresstype: draft.ipaddresstype,
    ipaddress: draft.ipaddress,
    subnet: draft.subnet,
    wpaType: draft.wpaType,
    password: draft.password,
    ssid: draft.ssid,
    band: draft.band,
    channel: draft.channel,
    mode: draft.mode,
    priority: draft.priority
  };
}

export function isSystemProfile(con) {
  return Boolean(con && con.role);
}

// Fallback profiles cannot be deactivated manually
export function isFallbackProfile(con) {
  return Boolean(con && (con.role === ROLE.ETH_SERVER || con.role === ROLE.WIFI_AP));
}

export function isValidIPv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}
