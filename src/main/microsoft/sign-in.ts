import { join } from 'node:path';
import { CryptoProvider, PublicClientApplication } from '@azure/msal-node';
import { app, safeStorage, shell } from 'electron';
import type { AddAccountResult } from '@shared/api';
import { requestCore } from '../core-process';
import { ADMIN_CONSENT_URL, AUTHORITY, CLIENT_ID, SCOPES } from './config';
import { classifyRedirectError, listenForRedirect, SignInAborted, type Loopback } from './loopback';
import { createCachePlugin } from './token-cache';

const SIGN_IN_TIMEOUT = 10 * 60 * 1000;

let client: PublicClientApplication | undefined;
let running: Loopback | undefined;

function getClient(): PublicClientApplication {
  client ??= new PublicClientApplication({
    auth: { clientId: CLIENT_ID, authority: AUTHORITY },
    cache: {
      cachePlugin: createCachePlugin(join(app.getPath('userData'), 'microsoft-sign-ins.bin'), {
        encrypt: (text) => safeStorage.encryptStringAsync(text),
        decrypt: async (data) => (await safeStorage.decryptStringAsync(data)).result,
      }),
    },
  });
  return client;
}

// On Linux the key for the encryption comes from the keyring. Without one it is a fixed key.
export async function hasSecureStorage(): Promise<boolean> {
  const available = await safeStorage.isAsyncEncryptionAvailable();
  return available && safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

export async function addMicrosoftAccount(): Promise<AddAccountResult> {
  if (running) return { status: 'failed', message: 'Another sign-in is still open' };
  try {
    const msal = getClient();
    const crypto = new CryptoProvider();
    const { verifier, challenge } = await crypto.generatePkceCodes();
    const state = crypto.createNewGuid();

    running = await listenForRedirect(state, SIGN_IN_TIMEOUT);
    const { redirectUri } = running;
    const signInUrl = await msal.getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri,
      state,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      prompt: 'select_account',
    });
    await shell.openExternal(signInUrl);

    const redirect = await running.redirect;
    if ('error' in redirect) {
      const kind = classifyRedirectError(redirect);
      if (kind === 'cancelled') return { status: 'cancelled' };
      if (kind === 'blocked') return { status: 'blocked', adminConsentUrl: ADMIN_CONSENT_URL };
      return { status: 'failed', message: redirect.description || redirect.error };
    }

    const result = await msal.acquireTokenByCode({
      code: redirect.code,
      codeVerifier: verifier,
      redirectUri,
      scopes: SCOPES,
    });
    if (!result.account) return { status: 'failed', message: 'Microsoft returned no account' };

    const { id } = await requestCore('accounts.add', {
      provider: 'graph',
      remoteId: result.account.homeAccountId,
      email: result.account.username,
      displayName: result.account.name || result.account.username,
    });
    return { status: 'added', accountId: id };
  } catch (error) {
    if (error instanceof SignInAborted && error.reason === 'cancelled') {
      return { status: 'cancelled' };
    }
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  } finally {
    running = undefined;
  }
}

export function cancelMicrosoftSignIn(): void {
  running?.cancel();
}

// Forgets the sign-in of an account that was removed from the app.
export async function forgetMicrosoftAccount(homeAccountId: string): Promise<void> {
  const cache = getClient().getTokenCache();
  const account = await cache.getAccountByHomeId(homeAccountId);
  if (account) await cache.removeAccount(account);
}

export { ADMIN_CONSENT_URL };
