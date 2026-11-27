import { createCore } from './core';

// Entry point of the core when Electron runs it as a utility process.
const databasePath = process.env.OUTLO_DATABASE;
if (!databasePath) throw new Error('OUTLO_DATABASE is not set');

const core = createCore({ databasePath });
core.seedDemoData().catch((error) => console.error('Creating the demo data failed', error));

// The main process sends one port for every UI window that connects.
process.parentPort.on('message', (event) => {
  const [port] = event.ports;
  if (!port) return;

  core.connect({
    post: (message) => port.postMessage(message),
    listen: (handler) => port.on('message', (portEvent) => handler(portEvent.data)),
    onClose: (handler) => port.on('close', handler),
  });
  port.start();
});
