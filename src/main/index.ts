import { app, session } from 'electron';
import { handleAppProtocol, registerAppScheme } from './app-protocol';
import { startCore } from './core-process';
import { hardenSession, hardenWebContents } from './security';
import { createMainWindow } from './window';

registerAppScheme();
app.enableSandbox();

app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
app.on('window-all-closed', () => app.quit());

void app.whenReady().then(() => {
  hardenSession(session.defaultSession);
  handleAppProtocol();
  startCore();
  createMainWindow();
});
