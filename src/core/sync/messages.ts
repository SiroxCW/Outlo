import { GraphError, type GraphClient } from '../graph/client';
import {
  MESSAGE_FIELDS,
  toRemoteMessage,
  type GraphMessage,
  type GraphPage,
  type RemoteMessage,
} from '../graph/mapping';
import type { MailStore, SyncFolder } from '../mail/store';

// The first page is small, so the newest mail is on screen quickly.
const FIRST_PAGE_SIZE = 50;
const PAGE_SIZE = 200;

// The server no longer knows the place where the sync wanted to continue.
function isSyncStateLost(error: unknown): boolean {
  if (!(error instanceof GraphError)) return false;
  return (
    error.status === 410 ||
    /SyncStateNotFound|ResyncRequired/i.test(error.code) ||
    (error.status === 400 && /token/i.test(error.message))
  );
}

export interface PageResult {
  changedFolderIds: number[];
  // More pages are waiting for this folder.
  more: boolean;
}

// Fetches and stores the next page of a folder's headers, newest first. Where it continues is
// stored with the folder, so the sync resumes after a restart or a lost connection.
export async function syncMessagePage(
  client: GraphClient,
  store: MailStore,
  accountId: number,
  folder: SyncFolder,
): Promise<PageResult> {
  let { syncLink: link, syncPending: pending, syncRound: round } = folder;
  const fromStart = link === null;
  if (link === null) {
    round = store.startFolderRound(folder.id);
    pending = 1;
    const id = encodeURIComponent(folder.remoteId);
    link = `/me/mailFolders/${id}/messages/delta?$select=${MESSAGE_FIELDS}&$orderby=receivedDateTime%20desc`;
  }

  let page: GraphPage<GraphMessage>;
  try {
    page = await client.request(link, { maxPageSize: fromStart ? FIRST_PAGE_SIZE : PAGE_SIZE });
  } catch (error) {
    if (fromStart || !isSyncStateLost(error)) throw error;
    // Read the folder from the start again. What is gone by then is removed at the end.
    store.setFolderSync(folder.id, null, 1);
    return { changedFolderIds: [], more: true };
  }

  const messages: RemoteMessage[] = [];
  const removedIds: string[] = [];
  for (const item of page.value ?? []) {
    if (item['@removed']) removedIds.push(item.id);
    else messages.push(toRemoteMessage(item));
  }
  const changed = new Set(
    store.saveRemoteMessages(accountId, folder.id, round, messages, removedIds),
  );

  const next = page['@odata.nextLink'];
  const done = page['@odata.deltaLink'];
  if (next) {
    store.setFolderSync(folder.id, next, pending || 2);
    return { changedFolderIds: [...changed], more: true };
  }
  if (!done) throw new GraphError(0, 'NoLink', 'The answer does not say where the sync continues');

  if (pending === 1 && store.finishFolderRound(folder.id, round) > 0) changed.add(folder.id);
  store.setFolderSync(folder.id, done, 0);
  return { changedFolderIds: [...changed], more: false };
}
