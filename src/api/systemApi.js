// Client for the /api/system/* endpoints. Every call rejects with
// Error(<server message>) on a non-2xx status or a non-null `error` field.

function errorText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function createSystemApi(token) {
  const request = async (method, url, body) => {
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    };
    if (body !== undefined) options.body = JSON.stringify(body);
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
    getIdentity: () => request('GET', '/api/system/identity'),
    setHostname: (hostname, updateApSsid) => request('POST', '/api/system/hostname', { hostname, updateApSsid }),
    setSshPassword: (password) => request('POST', '/api/system/sshpassword', { password })
  };
}
