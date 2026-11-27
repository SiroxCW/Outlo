import type { AccountSyncStatus, HostServices } from '@shared/api';
import { GraphClient, OfflineError, SignInNeededError, type Fetch } from '../graph/client';
import type { MailStore } from '../mail/store';
import { AccountSync, type SyncEvents } from './account';

// A token is renewed this long before it expires, so no request starts with one about to end.
const TOKEN_MARGIN = 5 * 60 * 1000;

export type RequestHost = <Method extends keyof HostServices>(
  method: Method,
  params: HostServices[Method]['params'],
) => Promise<HostServices[Method]['result']>;

export interface SyncEngineOptions {
  store: MailStore;
  fetch: Fetch;
  requestHost: RequestHost;
  events: SyncEvents;
}

// Asks the main process for access tokens and keeps the current one in memory only.
function createTokenSource(requestHost: RequestHost, remoteId: string) {
  let current: { accessToken: string; expiresAt: number } | undefined;
  return async (force: boolean): Promise<string> => {
    if (!force && current && current.expiresAt - TOKEN_MARGIN > Date.now()) {
      return current.accessToken;
    }
    const result = await requestHost('auth.getToken', { remoteId, forceRefresh: force });
    if (result.status === 'ok') {
      current = result;
      return result.accessToken;
    }
    current = undefined;
    if (result.status === 'signInNeeded') throw new SignInNeededError('Sign-in needed');
    if (result.status === 'offline') throw new OfflineError('No connection to the sign-in service');
    throw new Error(result.message);
  };
}

// Runs one sync per Microsoft account.
export class SyncEngine {
  private readonly accounts = new Map<number, AccountSync>();

  constructor(private readonly options: SyncEngineOptions) {}

  // Call after accounts were added or removed. An account that is added again syncs right away.
  refresh(): void {
    const { store, fetch, requestHost, events } = this.options;
    const wanted = new Map(store.listRemoteAccounts('graph').map((entry) => [entry.id, entry]));

    for (const [accountId, sync] of this.accounts) {
      if (wanted.has(accountId)) {
        sync.syncNow();
        continue;
      }
      sync.stop();
      this.accounts.delete(accountId);
    }
    for (const { id, remoteId } of wanted.values()) {
      if (this.accounts.has(id)) continue;
      const client = new GraphClient({ fetch, getToken: createTokenSource(requestHost, remoteId) });
      const sync = new AccountSync({ accountId: id, client, store, events });
      this.accounts.set(id, sync);
      void sync.run();
    }
    events.statusChanged();
  }

  status(): AccountSyncStatus[] {
    return [...this.accounts.values()].map((sync) => sync.status());
  }

  syncNow(): void {
    for (const sync of this.accounts.values()) sync.syncNow();
  }

  stop(): void {
    for (const sync of this.accounts.values()) sync.stop();
    this.accounts.clear();
  }
}
