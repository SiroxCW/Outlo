#!/usr/bin/env node
// Signs in the way the app will (authorization code flow with PKCE) and checks that Graph answers.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

// MSAL adds openid and profile on its own, so the consent screen matches the one of the real app.
const SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'User.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'MailboxSettings.Read',
].join(' ');

const CHECKS = [
  ['Profile (User.Read)', '/me?$select=displayName,userPrincipalName'],
  ['Inbox (Mail.ReadWrite)', '/me/mailFolders/inbox?$select=totalItemCount,unreadItemCount'],
  ['Mailbox settings (MailboxSettings.Read)', '/me/mailboxSettings'],
];

// All personal Microsoft accounts share this tenant ID.
const PERSONAL_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';
const TIMEOUT_MS = 5 * 60 * 1000;

const [clientId, tenant = 'common'] = process.argv.slice(2);
if (!clientId) {
  console.error(
    'Usage: node scripts/signin-test.mjs <client-id> [common|consumers|organizations|<tenant-id>]',
  );
  process.exit(1);
}

const authority = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('base64url');
let redirectUri;

async function redeemCode(code) {
  const response = await fetch(`${authority}/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: SCOPES,
    }),
  });
  const tokens = await response.json();
  if (!response.ok) throw new Error(`${tokens.error}: ${tokens.error_description}`);
  return tokens;
}

async function runCheck(accessToken, [label, path]) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json();
  if (!response.ok) {
    console.log(
      `  ${label}: FAILED, ${response.status} ${body.error?.code}: ${body.error?.message}`,
    );
    return false;
  }
  const details = Object.entries(body)
    .filter(([key, value]) => !key.startsWith('@') && typeof value !== 'object')
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  console.log(`  ${label}: OK (${details})`);
  return true;
}

async function report(params) {
  if (params.get('state') !== state) throw new Error('The answer does not belong to this sign-in.');
  if (params.has('error')) {
    throw new Error(`${params.get('error')}: ${params.get('error_description')}`);
  }

  const tokens = await redeemCode(params.get('code'));
  const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());
  const accountType =
    claims.tid === PERSONAL_TENANT_ID
      ? 'personal Microsoft account'
      : `work or school account (tenant ${claims.tid})`;

  console.log('Sign-in worked.');
  console.log(`  Account type: ${accountType}`);
  console.log(`  Granted scopes: ${tokens.scope}`);
  console.log(`  Refresh token: ${tokens.refresh_token ? 'yes' : 'no'}`);

  let allOk = true;
  for (const check of CHECKS) {
    allOk = (await runCheck(tokens.access_token, check)) && allOk;
  }
  return allOk;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, redirectUri);
  if (url.pathname !== '/') {
    response.writeHead(404).end();
    return;
  }
  response
    .writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' })
    .end('Sign-in test finished. You can close this tab and go back to the terminal.');

  try {
    process.exitCode = (await report(url.searchParams)) ? 0 : 1;
  } catch (error) {
    console.error(`Sign-in failed.\n  ${error.message}`);
    process.exitCode = 1;
  }
  server.close();
  clearTimeout(timeout);
});

const timeout = setTimeout(() => {
  console.error('No answer after 5 minutes. Stopping.');
  process.exit(1);
}, TIMEOUT_MS);

// Entra ignores the port of a localhost redirect URI, so any free port works.
server.listen(0, '127.0.0.1', () => {
  redirectUri = `http://localhost:${server.address().port}`;
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  const authorizeUrl = `${authority}/authorize?${query}`;

  console.log(
    `Opening the browser. If nothing happens, open this address yourself:\n\n${authorizeUrl}\n`,
  );
  console.log('If the sign-in page shows an error and does not come back here, press Ctrl+C.\n');
  spawn('xdg-open', [authorizeUrl], { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
});
