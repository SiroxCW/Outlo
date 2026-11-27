import { serve } from '@shared/rpc';
import { handlers } from './handlers';

// Entry point of the core when Electron runs it as a utility process.
// The main process sends one port for every UI window that connects.
process.parentPort.on('message', (event) => {
  const [port] = event.ports;
  if (!port) return;

  serve(
    {
      post: (message) => port.postMessage(message),
      listen: (handler) => port.on('message', (portEvent) => handler(portEvent.data)),
    },
    handlers,
  );
  port.start();
});
