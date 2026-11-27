import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Redirect = { code: string } | { error: string; description: string; subcode: string };

export class SignInAborted extends Error {
  constructor(readonly reason: 'cancelled' | 'timeout') {
    super(reason === 'timeout' ? 'The sign-in took too long' : 'The sign-in was cancelled');
  }
}

export interface Loopback {
  redirectUri: string;
  // Settles when the browser comes back from the sign-in page. Rejects with SignInAborted.
  redirect: Promise<Redirect>;
  cancel(): void;
}

const PAGE = (title: string, text: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Outlo Mail</title>
<style>body{font:16px system-ui,sans-serif;margin:15vh auto;max-width:28em;padding:0 1em}</style>
</head><body><h1>${title}</h1><p>${text}</p></body></html>`;

// The sign-in runs in the system browser. Afterwards Microsoft sends the browser to an address
// on this computer, where this small server waits for exactly one answer.
export function listenForRedirect(state: string, timeoutMs: number): Promise<Loopback> {
  return new Promise((ready, failed) => {
    let settle: (redirect: Redirect) => void = () => undefined;
    let abort: (error: SignInAborted) => void = () => undefined;
    const redirect = new Promise<Redirect>((resolve, reject) => {
      settle = resolve;
      abort = reject;
    });
    // Nobody may be listening yet when the sign-in is cancelled early.
    redirect.catch(() => undefined);

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      // Only the answer that belongs to this sign-in counts. Everything else gets a 404.
      if (url.pathname !== '/' || url.searchParams.get('state') !== state) {
        response.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const page = code
        ? PAGE('You are signed in', 'You can close this tab and go back to Outlo Mail.')
        : PAGE('The sign-in did not work', 'Go back to Outlo Mail to see what happened.');
      response
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
        .end(page);
      finish();
      settle(
        code
          ? { code }
          : {
              error: url.searchParams.get('error') ?? 'unknown_error',
              description: url.searchParams.get('error_description') ?? '',
              subcode: url.searchParams.get('error_subcode') ?? '',
            },
      );
    });

    const timer = setTimeout(() => {
      finish();
      abort(new SignInAborted('timeout'));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
    };

    server.once('error', failed);
    // Entra ignores the port of a localhost redirect address, so any free port works.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      ready({
        redirectUri: `http://localhost:${port}`,
        redirect,
        cancel: () => {
          finish();
          abort(new SignInAborted('cancelled'));
        },
      });
    });
  });
}

// Tells apart why Microsoft sent the user back without a sign-in.
export function classifyRedirectError(
  redirect: Extract<Redirect, { error: string }>,
): 'cancelled' | 'blocked' | 'failed' {
  // AADSTS90094 and AADSTS900941: only an administrator can approve the app.
  if (/AADSTS9009(4|41)\b/.test(redirect.description)) return 'blocked';
  // AADSTS65004: the user declined on the consent screen.
  if (redirect.subcode === 'cancel' || /AADSTS65004\b/.test(redirect.description)) {
    return 'cancelled';
  }
  return 'failed';
}
