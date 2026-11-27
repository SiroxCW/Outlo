import { join } from 'node:path';
import { app, session } from 'electron';
import { handleAppProtocol, registerAppScheme } from './app-protocol';
import { startCore } from './core-process';
import { hardenSession, hardenWebContents } from './security';
import { createMainWindow, handleWindowRequests } from './window';

// Lower case as usual on Linux, and a folder of its own for development builds.
// --user-data-dir on the command line still wins.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), app.isPackaged ? 'outlo' : 'outlo-dev'));
}

// Inside a Flatpak the desktop file is named after the app ID. The window needs the same name,
// or the desktop cannot match it to its icon.
if (process.env.FLATPAK_ID) app.setDesktopName(`${process.env.FLATPAK_ID}.desktop`);

registerAppScheme();
app.enableSandbox();

app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
app.on('window-all-closed', () => app.quit());

void app.whenReady().then(() => {
  hardenSession(session.defaultSession);
  handleAppProtocol();
  startCore();
  handleWindowRequests();
  createMainWindow();
});
