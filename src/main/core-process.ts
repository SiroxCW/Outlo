import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain, MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron';
import { CORE_PORT, CORE_PORT_REQUEST } from '@shared/api';
import corePath from '../core/index?modulePath';
import { isRendererUrl } from './renderer-site';

let core: UtilityProcess | undefined;

export function startCore(): void {
  let quitting = false;
  app.once('before-quit', () => (quitting = true));

  // Until real accounts exist, the core works on a database of its own with demo data.
  const dataDirectory = app.getPath('userData');
  mkdirSync(dataDirectory, { recursive: true });
  core = utilityProcess.fork(corePath, [], {
    serviceName: 'Outlo Core',
    env: { ...process.env, OUTLO_DATABASE: join(dataDirectory, 'demo.db') },
  });
  core.on('exit', (code) => {
    core = undefined;
    if (!quitting) console.error(`Core process exited unexpectedly with code ${code}`);
  });

  // The UI asks for a line to the core on every page load. Both ends get one port of a new channel.
  ipcMain.on(CORE_PORT_REQUEST, (event) => {
    const frame = event.senderFrame;
    if (!core || !frame || frame !== event.sender.mainFrame || !isRendererUrl(frame.url)) return;

    const { port1, port2 } = new MessageChannelMain();
    core.postMessage(null, [port1]);
    event.sender.postMessage(CORE_PORT, null, [port2]);
  });
}
