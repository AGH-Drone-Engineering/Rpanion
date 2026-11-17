import { createRequest } from './systemApi.js';

// Client for the /api/terminal/* endpoints; errors as in systemApi.js
export function createTerminalApi(token) {
  const request = createRequest(token);

  return {
    getStatus: () => request('GET', '/api/terminal/status'),
    stop: () => request('POST', '/api/terminal/stop')
  };
}
