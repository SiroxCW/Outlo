import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { CONTENT_SECURITY_POLICY } from './csp';
import { APP_SCHEME, resolveAppFile } from './urls';

const RENDERER_ROOT = join(__dirname, '../renderer');

// Has to run before the app is ready.
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

export function handleAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppFile(RENDERER_ROOT, request.url);
    if (!file) return new Response('Not found', { status: 404 });

    try {
      const response = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
