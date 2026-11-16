// Client for the /api/network* endpoints. Every call rejects with
// Error(<server message>) on a non-2xx status or a non-null `error` field.

// Empty strings are dropped: the server validators reject '' for enum/int fields
function dropEmpty(key, value) {
  return value === '' ? undefined : value;
}

function errorText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function createNetworkApi(token) {
  const request = async (method, url, body) => {
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    };
    if (body !== undefined) options.body = JSON.stringify(body, dropEmpty);
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(errorText(data.error || data.message || `Request failed (${res.status})`));
    }
    if (data && data.error) {
      throw new Error(errorText(data.error));
    }
    return data;
  };

  return {
    getAdapters: () => request('GET', '/api/networkadapters').then(d => d.netDevice || []),
    getConnections: () => request('GET', '/api/networkconnections').then(d => d.netConnection || []),
    getWirelessStatus: () => request('GET', '/api/wirelessstatus').then(d => Boolean(d.wirelessEnabled)),
    setWirelessStatus: (status) => request('POST', '/api/setwirelessstatus', { status })
      .then(d => Boolean(d.wirelessEnabled)),
    scanWifi: () => request('GET', '/api/wifiscan').then(d => d.detWifi || []),
    getConnectionDetails: (uuid) => request('POST', '/api/networkIP', { conName: uuid })
      .then(d => d.netConnectionDetails || {}),
    activate: (uuid) => request('POST', '/api/networkactivate', { conName: uuid }),
    deactivate: (uuid) => request('POST', '/api/networkdeactivate', { conName: uuid }),
    remove: (uuid) => request('POST', '/api/networkdelete', { conName: uuid }),
    edit: (uuid, conSettings) => request('POST', '/api/networkedit', { conName: uuid, conSettings }),
    add: ({ conName, conType, conAdapter, conSettings }) =>
      request('POST', '/api/networkadd', { conName, conType, conAdapter, conSettings }).then(d => ({ uuid: d.uuid })),
    getEthernetAliases: () => request('GET', '/api/ethernetaliases').then(d => (Array.isArray(d) ? d : [])),
    setEthernetAliases: (aliases) => request('POST', '/api/ethernetaliases', { aliases }),
    getWifiSettings: () => request('GET', '/api/wifisettings'),
    setWifiSettings: (settings) => request('POST', '/api/wifisettings', settings)
  };
}
