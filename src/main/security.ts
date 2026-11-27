import { shell, type Session, type WebContents } from 'electron';
import { isSafeExternalUrl } from '@shared/links';
import { DEV_CONTENT_SECURITY_POLICY } from './csp';
import { isDevServer, isRendererUrl, rendererUrl } from './renderer-site';

export function hardenSession(session: Session): void {
  // The UI needs no camera, location or similar. Grant nothing until a feature asks for it.
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);

  if (isDevServer) {
    session.webRequest.onHeadersReceived(
      { urls: [`${new URL(rendererUrl).origin}/*`] },
      (details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [DEV_CONTENT_SECURITY_POLICY],
          },
        });
      },
    );
  }
}

export function hardenWebContents(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (!isRendererUrl(url)) event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-attach-webview', (event) => event.preventDefault());
}
