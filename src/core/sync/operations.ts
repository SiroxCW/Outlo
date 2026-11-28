import { createLog } from '@shared/log';
import {
  GraphError,
  OfflineError,
  SignInNeededError,
  type GraphClient,
  type GraphRequest,
} from '../graph/client';
import type { MailStore, Operation } from '../mail/store';

const log = createLog('changes');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
// Changes sent in one step. The client sends at most four at a time.
const ROUND_SIZE = 20;
// After this many failed tries a change is given up and undone here.
const MAX_ATTEMPTS = 10;

export interface SendResult {
  // Folders whose content changed because a change was undone.
  changedFolderIds: number[];
  // Why sending stopped, like a lost connection. The changes that were not sent stay due.
  error?: unknown;
}

// The request that makes a change at Graph. Undefined for a kind this version does not know.
function toRequest(operation: Operation): { path: string; request: GraphRequest } | undefined {
  if (operation.remoteId === null) return undefined;
  const path = `/me/messages/${encodeURIComponent(operation.remoteId)}`;
  const { kind, value } = operation;
  if (kind === 'read')
    return { path, request: { method: 'PATCH', body: { isRead: value === true } } };
  if (kind === 'flag') {
    const flagStatus = value === true ? 'flagged' : 'notFlagged';
    return { path, request: { method: 'PATCH', body: { flag: { flagStatus } } } };
  }
  if (kind === 'move' && typeof value === 'string') {
    return { path: `${path}/move`, request: { method: 'POST', body: { destinationId: value } } };
  }
  return undefined;
}

// A problem that may go away by itself, unlike a refusal of the change.
function isTemporary(error: unknown): boolean {
  if (!(error instanceof GraphError)) return true;
  return [401, 408, 409, 429].includes(error.status) || error.status >= 500;
}

// Sends the changes that are due, up to one round. Returns null when none is due.
export async function sendOperations(
  client: GraphClient,
  store: MailStore,
  accountId: number,
  now: number,
): Promise<SendResult | null> {
  const due = store.listDueOperations(accountId, now, ROUND_SIZE);
  if (due.length === 0) return null;

  // Two changes of one message at the same time could get in each other's way at the provider.
  const round: { operation: Operation; path: string; request: GraphRequest }[] = [];
  const messages = new Set<string>();
  for (const operation of due) {
    const sent = toRequest(operation);
    if (!sent) {
      store.dropOperation(operation);
      log.warn('Dropped a change of an unknown kind', { account: accountId, kind: operation.kind });
    } else if (!messages.has(operation.remoteId!)) {
      messages.add(operation.remoteId!);
      round.push({ operation, ...sent });
    }
  }

  const started = performance.now();
  const operations = round.map((entry) => entry.operation);
  store.markSending(operations, true);
  const results = await Promise.allSettled(
    round.map(({ path, request }) => client.request<{ id?: string } | undefined>(path, request)),
  ).finally(() => store.markSending(operations, false));

  const changed = new Set<number>();
  const counts = { sent: 0, waiting: 0, undone: 0 };
  let stopped: unknown;
  results.forEach((result, index) => {
    const { operation } = round[index]!;
    const fields = { account: accountId, operation: operation.id, kind: operation.kind };
    if (result.status === 'fulfilled') {
      store.finishOperation(operation);
      // With immutable IDs a message keeps its ID when it moves. Should it get a new one anyway,
      // the message here follows, or the sync would take it for a second message.
      const newId = result.value?.id;
      if (operation.kind === 'move' && newId && newId !== operation.remoteId) {
        store.replaceRemoteId(accountId, operation.remoteId!, newId);
        log.info('A moved message got a new ID', fields);
      }
      counts.sent++;
      return;
    }
    const error: unknown = result.reason;
    // Without a connection or a sign-in nothing can be sent. The change stays due.
    if (error instanceof OfflineError || error instanceof SignInNeededError) {
      stopped = error;
      return;
    }
    const attempt = operation.attempts + 1;
    if (isTemporary(error) && attempt < MAX_ATTEMPTS) {
      const wait = Math.min(15 * SECOND * 2 ** operation.attempts, 10 * MINUTE);
      store.delayOperation(operation, now + wait);
      counts.waiting++;
      log.warn('A change waits for another try', { ...fields, attempt, waitMs: wait }, error);
      return;
    }
    for (const folderId of store.undoOperation(operation)) changed.add(folderId);
    counts.undone++;
    // Gone: the message, or for a move maybe its new folder. Where the message is now is not
    // certain, so its old folder is read again.
    if (error instanceof GraphError && error.status === 404) {
      log.info('A change was undone: its message or folder is gone', fields);
      if (operation.kind === 'move' && typeof operation.before === 'string') {
        store.restartFolderSync(accountId, operation.before);
      }
      return;
    }
    log.warn('A change was refused and undone here', { ...fields, attempts: attempt }, error);
  });

  if (counts.sent + counts.waiting + counts.undone > 0) {
    log.info('Sent changes to the provider', {
      account: accountId,
      ...counts,
      ms: Math.round(performance.now() - started),
    });
  }
  return { changedFolderIds: [...changed], error: stopped };
}
