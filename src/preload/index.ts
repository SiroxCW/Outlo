import { contextBridge, ipcRenderer } from 'electron';
import {
  CORE_PORT,
  ACCOUNTS_ADD_MICROSOFT,
  ACCOUNTS_ADD_WEB,
  ACCOUNTS_CANCEL_ADD,
  ACCOUNTS_REMOVE,
  ATTACHMENTS_OPEN,
  ATTACHMENTS_SAVE,
  CORE_PORT_REQUEST,
  LOGS_OPEN_FOLDER,
  SESSION_GET_INFO,
  SESSION_SET_DEMO,
  WEB_HIDE,
  WEB_MODULE,
  WEB_OPEN,
  WEB_RELOAD,
  WEB_SHOW,
  WEB_SNAPSHOT,
  WINDOW_GET_TITLE_BAR,
  WINDOW_SET_COLORS,
  WINDOW_SET_THEME,
  WINDOW_SET_TITLE_BAR,
  type CoreEvents,
  type CoreRequests,
  type OutloBridge,
  type WebModule,
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
    setTheme: (theme) => ipcRenderer.send(WINDOW_SET_THEME, theme),
  },
  accounts: {
    addMicrosoft: () => ipcRenderer.invoke(ACCOUNTS_ADD_MICROSOFT),
    addWeb: (email, kind) => ipcRenderer.invoke(ACCOUNTS_ADD_WEB, email, kind),
    cancelAdd: () => ipcRenderer.send(ACCOUNTS_CANCEL_ADD),
    remove: (accountId) => ipcRenderer.invoke(ACCOUNTS_REMOVE, accountId),
  },
  attachments: {
    open: (attachmentId) => ipcRenderer.invoke(ATTACHMENTS_OPEN, attachmentId),
    save: (attachmentId) => ipcRenderer.invoke(ATTACHMENTS_SAVE, attachmentId),
  },
  web: {
    show: (accountId, bounds) => ipcRenderer.send(WEB_SHOW, accountId, bounds),
    hide: () => ipcRenderer.send(WEB_HIDE),
    reload: (accountId) => ipcRenderer.send(WEB_RELOAD, accountId),
    open: (accountId, page) => ipcRenderer.send(WEB_OPEN, accountId, page),
    snapshot: (accountId) => ipcRenderer.invoke(WEB_SNAPSHOT, accountId),
    onModule: (listener) => {
      const handler = (_event: unknown, accountId: number, module: WebModule) =>
        listener(accountId, module);
      ipcRenderer.on(WEB_MODULE, handler);
      return () => void ipcRenderer.removeListener(WEB_MODULE, handler);
    },
  },
  session: {
    getInfo: () => ipcRenderer.invoke(SESSION_GET_INFO),
    setDemo: (demo) => ipcRenderer.invoke(SESSION_SET_DEMO, demo),
  },
  logs: {
    openFolder: () => ipcRenderer.send(LOGS_OPEN_FOLDER),
  },
};
contextBridge.exposeInMainWorld('outlo', bridge);
