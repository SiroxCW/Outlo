import { contextBridge, ipcRenderer } from 'electron';
import { CORE_PORT, CORE_PORT_REQUEST, type CoreRequests, type OutloBridge } from '@shared/api';
import { createClient } from '@shared/rpc';

let port: MessagePort | undefined;
let onMessage: ((message: unknown) => void) | undefined;
const waiting: unknown[] = [];

ipcRenderer.on(CORE_PORT, (event) => {
  port = event.ports[0];
  if (!port) return;
  port.onmessage = (portEvent) => onMessage?.(portEvent.data);
  for (const message of waiting.splice(0)) port.postMessage(message);
});
ipcRenderer.send(CORE_PORT_REQUEST);

// The port stays in this script. The page only gets the request function.
const request = createClient<CoreRequests>({
  post: (message) => (port ? port.postMessage(message) : waiting.push(message)),
  listen: (handler) => {
    onMessage = handler;
  },
});

const bridge: OutloBridge = { request };
contextBridge.exposeInMainWorld('outlo', bridge);
