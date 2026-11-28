import type { Address } from '@shared/api';
import { createLog } from '@shared/log';
import { GraphError, OfflineError, SignInNeededError, type GraphClient } from '../graph/client';
import type { DraftToSend, MailStore } from '../mail/store';
import type { SendResult } from './operations';

const log = createLog('drafts');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
// Drafts saved in one step, one after the other.
const ROUND_SIZE = 5;
// How the provider makes a draft that answers or forwards a message. It makes it part of the
// conversation, which a draft of its own would not be.
const ANSWER_PATHS = {
  reply: 'createReply',
  replyAll: 'createReplyAll',
  forward: 'createForward',
} as const;

interface Created {
  id: string;
}

// The fields of a draft as Graph takes them.
function toGraph(draft: DraftToSend) {
  const people = (list: Address[]) =>
    list.map((entry) => ({
      emailAddress: entry.name
        ? { name: entry.name, address: entry.address }
        : { address: entry.address },
    }));
  return {
    subject: draft.subject,
    body: { contentType: 'HTML', content: draft.html },
    toRecipients: people(draft.to),
    ccRecipients: people(draft.cc),
    bccRecipients: people(draft.bcc),
  };
}

const isGone = (error: unknown) => error instanceof GraphError && error.status === 404;

// Brings one draft to the provider: makes it there if it is not there yet, then sets what the
// user wrote.
async function saveThere(client: GraphClient, store: MailStore, draft: DraftToSend) {
  const { accountId, messageId } = draft;
  let current: DraftToSend | null = draft;
  if (draft.remoteId === null) {
    let answer: Created | undefined;
    if (draft.kind !== 'new' && draft.sourceRemoteId) {
      const source = encodeURIComponent(draft.sourceRemoteId);
      try {
        answer = await client.request<Created>(
          `/me/messages/${source}/${ANSWER_PATHS[draft.kind]}`,
          { method: 'POST', body: {} },
        );
      } catch (error) {
        if (!isGone(error)) throw error;
        log.info('The message a draft answers is gone. The draft is made on its own', {
          account: accountId,
        });
        store.forgetDraftSource(messageId);
      }
    }
    if (!answer) {
      const made = await client.request<Created>('/me/messages', {
        method: 'POST',
        body: toGraph(draft),
      });
      log.info('Made a draft at the provider', { account: accountId, kind: 'new' });
      // Thrown away meanwhile: the store sends the new draft to Deleted Items.
      if (store.draftCreated(accountId, messageId, made.id)) {
        store.draftSaved(messageId, draft.version);
      }
      return;
    }
    log.info('Made a draft at the provider', { account: accountId, kind: draft.kind });
    if (!store.draftCreated(accountId, messageId, answer.id)) return;
    // What the user wrote meanwhile goes along.
    current = store.getDraftToSend(messageId);
    if (!current?.remoteId) return;
  }
  try {
    await client.request(`/me/messages/${encodeURIComponent(current.remoteId!)}`, {
      method: 'PATCH',
      body: toGraph(current),
    });
  } catch (error) {
    if (!isGone(error)) throw error;
    log.info('A draft is gone at the provider and is made again', { account: accountId });
    store.draftGone(messageId);
    return;
  }
  store.draftSaved(messageId, current.version);
}

// Saves the drafts that are due at the provider, up to one round. Null when none is due.
// The text stays here whatever the provider answers: a draft is never undone like a change, it
// is tried again later.
export async function sendDrafts(
  client: GraphClient,
  store: MailStore,
  accountId: number,
  now: number,
): Promise<SendResult | null> {
  const due = store.listDueDrafts(accountId, now, ROUND_SIZE);
  if (due.length === 0) return null;
  for (const draft of due) {
    try {
      await saveThere(client, store, draft);
    } catch (error) {
      if (error instanceof OfflineError || error instanceof SignInNeededError) {
        return { changedFolderIds: [], error };
      }
      const wait = Math.min(15 * SECOND * 2 ** draft.attempts, 10 * MINUTE);
      store.delayDraft(draft.messageId, now + wait);
      log.warn(
        'A draft waits for another try',
        { account: accountId, attempt: draft.attempts + 1, waitMs: wait },
        error,
      );
    }
  }
  return { changedFolderIds: [] };
}
