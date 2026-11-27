import { net } from 'electron';
import type { Endpoint } from '@shared/rpc';
import { createCore } from './core';

// Entry point of the core when Electron runs it as a utility process.
const databasePath = process.env.OUTLO_DATABASE;
if (!databasePath) throw new Error('OUTLO_DATABASE is not set');

// Electron's network stack follows the proxy settings of the system. Node's own does not.
const core = createCore({ databasePath, fetch: (url, init) => net.fetch(url, init) });
if (process.env.OUTLO_DEMO === '1') {
  core.seedDemoData().catch((error) => console.error('Creating the demo data failed', error));
}

// The main process sends two ports for itself and one for every UI window that connects.
process.parentPort.on('message', (event) => {
  const [port] = event.ports;
  if (!port) return;

  const endpoint: Endpoint = {
    post: (message) => port.postMessage(message),
    listen: (handler) => port.on('message', (portEvent) => handler(portEvent.data)),
    onClose: (handler) => port.on('close', handler),
  };
  if (event.data === 'host') core.connectHost(endpoint);
  else if (event.data === 'services') core.connectServices(endpoint);
  else core.connect(endpoint);
  port.start();
});
