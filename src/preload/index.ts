import { contextBridge, ipcRenderer } from 'electron';
import {
  CORE_PORT,
  CORE_PORT_REQUEST,
  WINDOW_GET_TITLE_BAR,
  WINDOW_SET_COLORS,
  WINDOW_SET_TITLE_BAR,
  type CoreEvents,
  type CoreRequests,
  type OutloBridge,
} from '@shared/api';
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

// The port stays in this script. The page only gets these two functions.
const client = createClient<CoreRequests, CoreEvents>({
  post: (message) => (port ? port.postMessage(message) : waiting.push(message)),
  listen: (handler) => {
    onMessage = handler;
  },
});

const bridge: OutloBridge = {
  request: (method, params) => client.request(method, params),
  subscribe: (listener) => client.subscribe(listener),
  window: {
    getTitleBarStyle: () => ipcRenderer.invoke(WINDOW_GET_TITLE_BAR),
    setTitleBarStyle: (style) => ipcRenderer.invoke(WINDOW_SET_TITLE_BAR, style),
    setTitleBarColors: (colors) => ipcRenderer.send(WINDOW_SET_COLORS, colors),
  },
};
contextBridge.exposeInMainWorld('outlo', bridge);
