import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import { CORE_PORT, CORE_PORT_REQUEST, type HostRequests } from '@shared/api';
import { createClient } from '@shared/rpc';
import corePath from '../core/index?modulePath';
import { isTrustedSender } from './renderer-site';

let core: UtilityProcess | undefined;
let host: ReturnType<typeof createClient<HostRequests>> | undefined;
let demo = false;
let quitting = false;

// The demo and the real mail live in two databases, so they can never mix.
function fork(): void {
  const dataDirectory = app.getPath('userData');
  mkdirSync(dataDirectory, { recursive: true });
  const child = utilityProcess.fork(corePath, [], {
    serviceName: 'Outlo Mail Core',
    env: {
      ...process.env,
      OUTLO_DATABASE: join(dataDirectory, demo ? 'demo.db' : 'mail.db'),
      OUTLO_DEMO: demo ? '1' : '0',
    },
  });
  child.on('exit', (code) => {
    if (core !== child) return;
    core = undefined;
    host = undefined;
    if (!quitting) console.error(`Core process exited unexpectedly with code ${code}`);
  });

  // A line of its own for the main process, for the requests the UI is not allowed to send.
  const { port1, port2 } = new MessageChannelMain();
  child.postMessage('host', [port1]);
  host = createClient<HostRequests>({
    post: (message) => port2.postMessage(message),
    listen: (handler) => port2.on('message', (event) => handler(event.data)),
  });
  port2.start();
  core = child;
}

export function startCore(options: { demo: boolean }): void {
  demo = options.demo;
  app.once('before-quit', () => (quitting = true));
  fork();

  // The UI asks for a line to the core on every page load. Both ends get one port of a new channel.
  ipcMain.on(CORE_PORT_REQUEST, (event) => {
    if (!core || !isTrustedSender(event)) return;
    const { port1, port2 } = new MessageChannelMain();
    core.postMessage('ui', [port1]);
    event.sender.postMessage(CORE_PORT, null, [port2]);
  });
}

export function isDemoSession(): boolean {
  return demo;
}

// Stops the core and starts it again on the other database. The windows reload to reconnect.
export async function setDemoSession(next: boolean): Promise<void> {
  if (next === demo) return;
  const old = core;
  core = undefined;
  host = undefined;
  if (old) {
    await new Promise<void>((resolve) => {
      old.once('exit', () => resolve());
      old.kill();
    });
  }
  demo = next;
  fork();
  for (const window of BrowserWindow.getAllWindows()) window.webContents.reload();
}

export function requestCore<Method extends keyof HostRequests & string>(
  method: Method,
  params: HostRequests[Method]['params'],
): Promise<HostRequests[Method]['result']> {
  if (!host) return Promise.reject(new Error('The core process is not running'));
  return host.request(method, params);
}
