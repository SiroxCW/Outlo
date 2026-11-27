import type { AccountSyncStatus, FolderRole, SyncState } from '@shared/api';
import { GraphError, OfflineError, SignInNeededError, type GraphClient } from '../graph/client';
import type { MailStore, SyncFolder } from '../mail/store';
import { fetchBody } from './bodies';
import { fetchFolders, fetchRoles, toRemoteFolders } from './folders';
import { syncMessagePage } from './messages';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const INBOX_INTERVAL = 30 * SECOND;
const OTHER_INTERVAL = 5 * MINUTE;
const FOLDER_LIST_INTERVAL = 5 * MINUTE;
const ROLES_INTERVAL = 60 * MINUTE;
// The texts of mail this recent are fetched ahead, so it can be read without a connection.
const PREFETCH_AGE = 30 * 24 * 60 * MINUTE;
const PREFETCH_BATCH = 50;

// Standard folders are fetched before the folders the user made, the inbox before all others.
const PRIORITY: (FolderRole | null)[] = ['inbox', 'sent', 'drafts', 'archive', null];

export interface SyncEvents {
  foldersChanged(): void;
  messagesChanged(folderIds: number[]): void;
  statusChanged(): void;
}

export interface AccountSyncOptions {
  accountId: number;
  client: GraphClient;
  store: MailStore;
  events: SyncEvents;
  now?: () => number;
}

function priority(folder: SyncFolder): number {
  const index = PRIORITY.indexOf(folder.role);
  return index === -1 ? PRIORITY.length : index;
}

// Keeps one account up to date. It works in small steps, one request each, so news in the
// inbox does not have to wait until a large folder has been fetched completely.
export class AccountSync {
  private readonly now: () => number;
  private state: SyncState = 'syncing';
  private message: string | null = null;
  private roles: Map<string, FolderRole> | undefined;
  private rolesAt = 0;
  private foldersAt: number | undefined;
  private readonly hiddenChildren = new Map<string, number>();
  private readonly checkedAt = new Map<number, number>();
  private bodyQueue: { id: number; remoteId: string }[] = [];
  // Texts that could not be fetched. They are not tried again before the next start.
  private readonly bodiesSkipped = new Set<number>();
  private readonly bodiesLoading = new Map<number, Promise<void>>();
  private failures = 0;
  private stopped = false;
  private wakeUp: (() => void) | undefined;

  constructor(private readonly options: AccountSyncOptions) {
    this.now = options.now ?? Date.now;
  }

  status(): AccountSyncStatus {
    return { accountId: this.options.accountId, state: this.state, message: this.message };
  }

  // Runs until stop() is called.
  async run(): Promise<void> {
    while (!this.stopped) {
      const wait = await this.stepSafely();
      if (wait > 0 && !this.stopped) await this.pause(wait);
    }
  }

  stop(): void {
    this.stopped = true;
    this.wakeUp?.();
  }

  // Fetches the text of one message right now, for example because the user opened it.
  loadBody(messageId: number, remoteId: string): Promise<void> {
    let loading = this.bodiesLoading.get(messageId);
    if (!loading) {
      const { client, store } = this.options;
      loading = fetchBody(client, store, messageId, remoteId).finally(() =>
        this.bodiesLoading.delete(messageId),
      );
      this.bodiesLoading.set(messageId, loading);
    }
    return loading;
  }

  // Fetches the text of the next recent message that has none. False when none is left.
  private async prefetchBody(now: number): Promise<boolean> {
    if (this.bodyQueue.length === 0) {
      this.bodyQueue = this.options.store
        .listMessagesWithoutBody(
          this.options.accountId,
          now - PREFETCH_AGE,
          PREFETCH_BATCH + this.bodiesSkipped.size,
        )
        .filter((entry) => !this.bodiesSkipped.has(entry.id));
    }
    const next = this.bodyQueue.shift();
    if (!next) return false;
    try {
      await this.loadBody(next.id, next.remoteId);
    } catch (error) {
      // One message that cannot be fetched must not hold up the others.
      if (!(error instanceof GraphError)) throw error;
      this.bodiesSkipped.add(next.id);
    }
    return true;
  }

  // Checks everything for news now, also after an error.
  syncNow(): void {
    this.foldersAt = undefined;
    this.checkedAt.clear();
    this.wakeUp?.();
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private setState(state: SyncState, message: string | null = null): void {
    if (state === this.state && message === this.message) return;
    this.state = state;
    this.message = message;
    this.options.events.statusChanged();
  }

  // Does one step and returns how long to wait before the next one. Never throws.
  async stepSafely(): Promise<number> {
    try {
      const wait = await this.step();
      this.failures = 0;
      return wait;
    } catch (error) {
      this.failures++;
      const backoff = Math.min(15 * SECOND * 2 ** (this.failures - 1), 10 * MINUTE);
      if (error instanceof SignInNeededError) {
        this.setState('signInNeeded');
        return 60 * MINUTE;
      }
      if (
        error instanceof GraphError &&
        /MailboxNot(Enabled|Supported)ForRESTAPI/.test(error.code)
      ) {
        this.setState('noMailbox');
        return 60 * MINUTE;
      }
      if (error instanceof OfflineError) {
        this.setState('offline');
        return Math.min(backoff, MINUTE);
      }
      this.setState('error', error instanceof Error ? error.message : String(error));
      return backoff;
    }
  }

  // One step is at most one round of requests for the folder list or one page of headers.
  // Returns 0 when more work is waiting, otherwise the time until the next check is due.
  async step(): Promise<number> {
    const { accountId, client, store, events } = this.options;
    const now = this.now();

    if (this.foldersAt === undefined || now - this.foldersAt >= FOLDER_LIST_INTERVAL) {
      if (!this.roles || now - this.rolesAt >= ROLES_INTERVAL) {
        this.roles = await fetchRoles(client);
        this.rolesAt = now;
      }
      const folders = toRemoteFolders(await fetchFolders(client, this.hiddenChildren), this.roles);
      if (store.saveRemoteFolders(accountId, folders)) events.foldersChanged();
      this.foldersAt = now;
      return 0;
    }

    const folders = store.listSyncFolders(accountId).sort((a, b) => priority(a) - priority(b));
    // A folder that reached its end is checked again after its interval. One with waiting pages
    // comes after the checks that are due, so news always wins over old mail.
    const due = folders.find((folder) => {
      const interval = folder.role === 'inbox' ? INBOX_INTERVAL : OTHER_INTERVAL;
      const checked = this.checkedAt.get(folder.id);
      return folder.syncPending === 0 && (checked === undefined || now - checked >= interval);
    });
    const folder = due ?? folders.find((entry) => entry.syncPending !== 0);

    if (!folder) {
      // All headers are there. Now the texts of recent mail, one message per step.
      if (await this.prefetchBody(now)) {
        this.setState('syncing');
        return 0;
      }
      this.setState('idle');
      const nextCheck = folders.map((entry) => {
        const interval = entry.role === 'inbox' ? INBOX_INTERVAL : OTHER_INTERVAL;
        return (this.checkedAt.get(entry.id) ?? now) + interval;
      });
      const next = Math.min(this.foldersAt + FOLDER_LIST_INTERVAL, ...nextCheck);
      return Math.max(next - now, SECOND);
    }

    if (folder.syncPending !== 0) this.setState('syncing');
    const fromStart = folder.syncLink === null || folder.syncPending === 1;
    let result;
    try {
      result = await syncMessagePage(client, store, accountId, folder);
    } catch (error) {
      // The folder is gone at the provider. The next folder list removes it here too.
      if (error instanceof GraphError && error.status === 404) {
        this.checkedAt.set(folder.id, now);
        this.foldersAt = undefined;
        return 0;
      }
      throw error;
    }
    if (!result.more) this.checkedAt.set(folder.id, now);
    if (result.changedFolderIds.length > 0) {
      events.messagesChanged(result.changedFolderIds);
      // The counters of the folders come from the provider. After news they are fetched again.
      // A first read of a folder does not need that: its counters are fresh.
      if (!result.more && !fromStart) this.foldersAt = undefined;
    }
    return 0;
  }
}
