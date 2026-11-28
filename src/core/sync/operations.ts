import { createLog } from '@shared/log';
import { GraphError, OfflineError, SignInNeededError, type GraphClient } from '../graph/client';
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

// What Graph has to set for a change. Undefined for a kind this version does not know.
function toPatch(operation: Operation): Record<string, unknown> | undefined {
  if (operation.kind === 'read') return { isRead: operation.value };
  if (operation.kind === 'flag') {
    return { flag: { flagStatus: operation.value ? 'flagged' : 'notFlagged' } };
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
  const round: { operation: Operation; patch: Record<string, unknown> }[] = [];
  const messages = new Set<string>();
  for (const operation of due) {
    const patch = toPatch(operation);
    if (!patch || operation.remoteId === null) {
      store.dropOperation(operation);
      log.warn('Dropped a change of an unknown kind', { account: accountId, kind: operation.kind });
    } else if (!messages.has(operation.remoteId)) {
      messages.add(operation.remoteId);
      round.push({ operation, patch });
    }
  }

  const started = performance.now();
  const results = await Promise.allSettled(
    round.map(({ operation, patch }) =>
      client.request(`/me/messages/${encodeURIComponent(operation.remoteId!)}`, {
        method: 'PATCH',
        body: patch,
      }),
    ),
  );

  const changed = new Set<number>();
  const counts = { sent: 0, waiting: 0, undone: 0 };
  let stopped: unknown;
  results.forEach((result, index) => {
    const { operation } = round[index]!;
    const fields = { account: accountId, operation: operation.id, kind: operation.kind };
    if (result.status === 'fulfilled') {
      store.finishOperation(operation);
      counts.sent++;
      return;
    }
    const error: unknown = result.reason;
    // Without a connection or a sign-in nothing can be sent. The change stays due.
    if (error instanceof OfflineError || error instanceof SignInNeededError) {
      stopped = error;
      return;
    }
    // The message is gone at the provider, and the sync removes it here too.
    if (error instanceof GraphError && error.status === 404) {
      store.dropOperation(operation);
      log.info('Dropped a change of a message that is gone', fields);
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
