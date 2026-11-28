import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder } from '@shared/api';
import { LOG_LINE, setUpLog } from '@shared/log';
import { openDatabase } from '../db/database';
import { GraphClient } from '../graph/client';
import { MailStore } from '../mail/store';
import { AccountSync } from './account';
import { FakeGraph } from './fake-graph';

const MINUTE = 60_000;

let graph: FakeGraph;
let store: MailStore;
let accountId: number;
let now: number;
let events: string[];
let token: () => Promise<string>;
let inbox: string;
let sent: string;
let drafts: string;
let projects: string;

function createSync(): AccountSync {
  const client = new GraphClient({
    fetch: graph.fetch,
    getToken: () => token(),
    sleep: async () => {},
  });
  return new AccountSync({
    accountId,
    client,
    store,
    now: () => now,
    events: {
      foldersChanged: () => events.push('folders'),
      messagesChanged: (ids) => events.push(`messages:${ids.join(',')}`),
      statusChanged: () => events.push('status'),
    },
  });
}

// Steps until nothing is left to do, as the loop of the app would.
async function settle(sync: AccountSync): Promise<number> {
  for (let steps = 1; steps < 500; steps++) {
    if ((await sync.stepSafely()) > 0) return steps;
  }
  throw new Error('The sync does not come to an end');
}

const folder = (name: string): Folder => store.listFolders().find((entry) => entry.name === name)!;
const subjects = (name: string) =>
  store.listMessages(folder(name).id, 'all', 0, 500).messages.map((message) => message.subject);

beforeEach(() => {
  graph = new FakeGraph();
  store = new MailStore(openDatabase(':memory:'));
  accountId = store.addAccount('graph', 'home-1', 'me@remote.example', 'Me');
  now = Date.UTC(2026, 10, 27);
  events = [];
  token = async () => 'token';
  inbox = graph.addFolder('Posteingang', { wellKnown: 'inbox' });
  sent = graph.addFolder('Gesendete Elemente', { wellKnown: 'sentitems' });
  drafts = graph.addFolder('Entwürfe', { wellKnown: 'drafts' });
  projects = graph.addFolder('Projects');
});

describe('folders', () => {
  it('stores the folders with roles, tree and the order of the folder pane', async () => {
    const child = graph.addFolder('Website', { parent: projects });
    graph.addFolder('Alpha', { parent: child });
    graph.addFolder('archive of 2020');
    graph.addFolder('Secret', { hidden: true });
    await settle(createSync());

    const folders = store.listFolders();
    expect(folders.map((entry) => [entry.name, entry.role])).toEqual([
      ['Posteingang', 'inbox'],
      ['Entwürfe', 'drafts'],
      ['Gesendete Elemente', 'sent'],
      ['archive of 2020', null],
      ['Projects', null],
      ['Website', null],
      ['Alpha', null],
    ]);
    expect(folder('Website').parentId).toBe(folder('Projects').id);
    expect(folder('Alpha').parentId).toBe(folder('Website').id);
    expect(folder('Projects').parentId).toBeNull();
    expect(folders.filter((entry) => entry.isFavorite).map((entry) => entry.name)).toEqual([
      'Posteingang',
    ]);
  });

  it('asks for children when the folder list only holds the top level', async () => {
    graph.nestedFolderList = false;
    const child = graph.addFolder('Website', { parent: projects });
    graph.addFolder('Alpha', { parent: child });
    await settle(createSync());
    expect(folder('Alpha').parentId).toBe(folder('Website').id);
  });

  it('asks only once about a folder whose children are all hidden', async () => {
    graph.addFolder('Team Chat', { parent: projects, hidden: true });
    const sync = createSync();
    await settle(sync);
    now += 6 * MINUTE;
    await settle(sync);
    const asked = graph.requests.filter((request) => request.endsWith('/childFolders'));
    expect(asked).toHaveLength(1);
  });

  it('takes the counters from the server', async () => {
    graph.addMessage(inbox, { isRead: true });
    graph.addMessage(inbox);
    await settle(createSync());
    expect(folder('Posteingang')).toMatchObject({ totalCount: 2, unreadCount: 1 });
  });

  it('follows renames and removes folders that are gone, with their messages', async () => {
    graph.addMessage(projects, { subject: 'Plan' });
    const sync = createSync();
    await settle(sync);
    expect(subjects('Projects')).toEqual(['Plan']);

    graph.renameFolder(sent, 'Sent');
    graph.removeFolder(projects);
    now += 6 * MINUTE;
    await settle(sync);
    expect(store.listFolders().map((entry) => entry.name)).toEqual([
      'Posteingang',
      'Entwürfe',
      'Sent',
    ]);
    expect(store.search('Plan', 10)).toEqual([]);
  });
});

describe('message headers', () => {
  it('fetches a folder newest first, in pages, and announces every page', async () => {
    for (let index = 0; index < 120; index++) graph.addMessage(inbox, { subject: `Mail ${index}` });
    const sync = createSync();
    await sync.step();
    events = [];
    await sync.step();

    // The first page is small and holds the newest mail.
    expect(subjects('Posteingang')).toHaveLength(50);
    expect(subjects('Posteingang')[0]).toBe('Mail 119');
    expect(events).toEqual([`messages:${folder('Posteingang').id}`]);
    expect(sync.status().state).toBe('syncing');

    await settle(sync);
    expect(subjects('Posteingang')).toHaveLength(120);
    expect(sync.status().state).toBe('idle');
  });

  it('stores the header fields', async () => {
    graph.addMessage(inbox, {
      subject: 'Offer',
      bodyPreview: 'Dear customer',
      from: { emailAddress: { name: 'Ann', address: 'ann@x.example' } },
      receivedDateTime: '2026-11-20T10:00:00Z',
      isRead: true,
      flag: { flagStatus: 'flagged' },
      importance: 'high',
      hasAttachments: true,
      inferenceClassification: 'other',
    });
    await settle(createSync());
    const [message] = store.listMessages(folder('Posteingang').id, 'other', 0, 10).messages;
    expect(message).toMatchObject({
      subject: 'Offer',
      preview: 'Dear customer',
      from: { name: 'Ann', address: 'ann@x.example' },
      to: [{ name: 'Me', address: 'me@remote.example' }],
      receivedAt: Date.UTC(2026, 10, 20, 10),
      isRead: true,
      isFlagged: true,
      isFocused: false,
      hasAttachments: true,
      importance: 'high',
    });
    expect(store.search('offer ann', 10)).toHaveLength(1);
  });

  it('puts messages of one conversation into one thread', async () => {
    graph.addMessage(inbox, { conversationId: 'c1' });
    graph.addMessage(sent, { conversationId: 'c1' });
    graph.addMessage(inbox, { conversationId: 'c2' });
    await settle(createSync());
    const ids = new Set(
      ['Posteingang', 'Gesendete Elemente'].flatMap((name) =>
        store
          .listMessages(folder(name).id, 'all', 0, 10)
          .messages.map((message) => message.threadId),
      ),
    );
    expect(ids.size).toBe(2);
    expect(ids.has(null)).toBe(false);
  });

  it('continues after a restart where it stopped', async () => {
    for (let index = 0; index < 300; index++) graph.addMessage(inbox);
    const first = createSync();
    await first.step();
    await first.step();
    await first.step();
    expect(subjects('Posteingang')).toHaveLength(250);

    graph.requests.length = 0;
    await settle(createSync());
    expect(subjects('Posteingang')).toHaveLength(300);
    const inboxRequests = graph.requests.filter((request) => request.includes(`${inbox}/messages`));
    expect(inboxRequests).toHaveLength(1);
  });

  it('checks the inbox before it continues with old mail of other folders', async () => {
    for (let index = 0; index < 700; index++) graph.addMessage(projects);
    const sync = createSync();
    for (let step = 0; step < 6; step++) await sync.step();
    expect(subjects('Projects').length).toBeLessThan(700);

    graph.addMessage(inbox, { subject: 'News' });
    now += 31_000;
    await sync.step();
    expect(subjects('Posteingang')).toEqual(['News']);
  });

  it('checks the inbox and Sent Items every 30 seconds and other folders every 5 minutes', async () => {
    const sync = createSync();
    expect(await settle(sync)).toBeGreaterThan(1);
    graph.requests.length = 0;

    now += 29_000;
    expect(await sync.step()).toBe(1000);
    expect(graph.requests).toEqual([]);

    now += 2_000;
    await settle(sync);
    expect(graph.requests).toEqual([
      `GET /me/mailFolders/${inbox}/messages/delta`,
      `GET /me/mailFolders/${sent}/messages/delta`,
    ]);

    graph.requests.length = 0;
    now += 5 * MINUTE;
    await settle(sync);
    const checked = graph.requests.filter((request) => request.endsWith('/messages/delta'));
    expect(checked).toHaveLength(4);
  });
});

describe('changes after the first sync', () => {
  it('picks up new, changed and deleted messages and refreshes the counters', async () => {
    const keep = graph.addMessage(inbox, { subject: 'Keep' });
    const gone = graph.addMessage(inbox, { subject: 'Gone' });
    const sync = createSync();
    await settle(sync);
    expect(folder('Posteingang').unreadCount).toBe(2);

    graph.addMessage(inbox, { subject: 'New' });
    graph.updateMessage(inbox, keep, { isRead: true, flag: { flagStatus: 'flagged' } });
    graph.removeMessage(inbox, gone);
    now += 31_000;
    events = [];
    await settle(sync);

    expect(subjects('Posteingang').sort()).toEqual(['Keep', 'New']);
    const kept = store
      .listMessages(folder('Posteingang').id, 'all', 0, 10)
      .messages.find((message) => message.subject === 'Keep');
    expect(kept).toMatchObject({ isRead: true, isFlagged: true });
    expect(folder('Posteingang')).toMatchObject({ totalCount: 2, unreadCount: 1 });
    expect(events).toEqual([`messages:${folder('Posteingang').id}`, 'folders']);
  });

  it('keeps stored fields when a change only names what changed', async () => {
    const id = graph.addMessage(inbox, { subject: 'Full' });
    const sync = createSync();
    await settle(sync);
    graph.intercept = (url) =>
      url.searchParams.has('$deltatoken') && url.pathname.includes(inbox)
        ? new Response(
            JSON.stringify({ value: [{ id, isRead: true }], '@odata.deltaLink': url.href }),
          )
        : undefined;
    now += 31_000;
    await sync.step();
    const [message] = store.listMessages(folder('Posteingang').id, 'all', 0, 10).messages;
    expect(message).toMatchObject({ subject: 'Full', isRead: true, preview: `Preview of ${id}` });
  });

  it.each(['target folder first', 'source folder first'])(
    'keeps a moved message exactly once (%s)',
    async (order) => {
      const id = graph.addMessage(inbox, { subject: 'Moving' });
      const sync = createSync();
      await settle(sync);
      const localId = store.listMessages(folder('Posteingang').id, 'all', 0, 10).messages[0]!.id;

      graph.moveMessage(id, inbox, projects);
      // The inbox is due after 30 seconds, the other folder after 5 minutes.
      if (order === 'source folder first') {
        now += 31_000;
        await settle(sync);
        expect(subjects('Posteingang')).toEqual([]);
        expect(subjects('Projects')).toEqual([]);
      } else {
        store.setFolderSync(folder('Posteingang').id, null, 1);
        const projectsOnly = store
          .listSyncFolders(accountId)
          .find((entry) => entry.remoteId === projects)!;
        const client = new GraphClient({ fetch: graph.fetch, getToken: async () => 'token' });
        const { syncMessagePage } = await import('./messages');
        await syncMessagePage(client, store, accountId, projectsOnly);
        expect(subjects('Projects')).toEqual(['Moving']);
      }
      now += 6 * MINUTE;
      await settle(sync);

      expect(subjects('Posteingang')).toEqual([]);
      expect(subjects('Projects')).toEqual(['Moving']);
      if (order === 'target folder first') {
        // The same row moved, so an open message stays open.
        expect(store.listMessages(folder('Projects').id, 'all', 0, 10).messages[0]!.id).toBe(
          localId,
        );
      }

      graph.moveMessage(id, projects, inbox);
      now += 6 * MINUTE;
      await settle(sync);
      expect(subjects('Posteingang')).toEqual(['Moving']);
      expect(subjects('Projects')).toEqual([]);
    },
  );

  it('reads a folder again when the server forgot where the sync was', async () => {
    graph.addMessage(inbox, { subject: 'Stays' });
    const leaves = graph.addMessage(inbox, { subject: 'Leaves' });
    const sync = createSync();
    await settle(sync);

    graph.removeMessage(inbox, leaves);
    graph.addMessage(inbox, { subject: 'Arrives' });
    graph.expireSyncState();
    now += 31_000;
    await settle(sync);

    expect(subjects('Posteingang').sort()).toEqual(['Arrives', 'Stays']);
    expect(sync.status().state).toBe('idle');
  });
});

describe('problems', () => {
  it('reports a missing connection and recovers', async () => {
    const sync = createSync();
    graph.offline = true;
    expect(await sync.stepSafely()).toBe(15_000);
    expect(await sync.stepSafely()).toBe(30_000);
    expect(sync.status().state).toBe('offline');

    graph.offline = false;
    graph.addMessage(inbox);
    await settle(sync);
    expect(sync.status().state).toBe('idle');
    expect(subjects('Posteingang')).toHaveLength(1);
  });

  it('reports when the sign-in no longer works', async () => {
    const { SignInNeededError } = await import('../graph/client');
    token = async () => {
      throw new SignInNeededError('expired');
    };
    const sync = createSync();
    await sync.stepSafely();
    expect(sync.status()).toEqual({ accountId, state: 'signInNeeded', message: null });
  });

  it('reports an account without a mailbox', async () => {
    graph.intercept = () =>
      new Response(
        JSON.stringify({ error: { code: 'MailboxNotEnabledForRESTAPI', message: 'No mailbox' } }),
        { status: 404 },
      );
    const sync = createSync();
    await sync.stepSafely();
    expect(sync.status().state).toBe('noMailbox');
  });

  it('reports other errors with their text and keeps what it has', async () => {
    graph.addMessage(inbox, { subject: 'Safe' });
    const sync = createSync();
    await settle(sync);
    graph.intercept = () =>
      new Response(JSON.stringify({ error: { code: 'Oops', message: 'Something broke' } }), {
        status: 500,
      });
    now += 6 * MINUTE;
    await sync.stepSafely();
    expect(sync.status()).toEqual({ accountId, state: 'error', message: 'Something broke' });
    expect(subjects('Posteingang')).toEqual(['Safe']);
  });
});

describe('changes made here', () => {
  const stored = (name: string) => store.listMessages(folder(name).id, 'all', 0, 500).messages;
  const localId = (remoteId: string) =>
    stored('Posteingang').find(
      (message) => store.getRemoteMessage(message.id)?.remoteId === remoteId,
    )!.id;
  const patches = () => graph.requests.filter((request) => request.startsWith('PATCH '));
  const refuse = (status: number, code = 'Test') => {
    graph.intercept = (_url, method) =>
      method !== 'GET'
        ? new Response(JSON.stringify({ error: { code, message: 'No' } }), { status })
        : undefined;
  };

  it('sends read and flag to the server, which then reports them back', async () => {
    const ids = Array.from({ length: 25 }, () => graph.addMessage(inbox));
    const sync = createSync();
    await settle(sync);
    const all = stored('Posteingang').map((message) => message.id);
    const newest = ids.at(-1)!;

    expect(store.setRead(all, true)).toEqual([folder('Posteingang').id]);
    store.setFlagged([localId(newest)], true);
    expect(folder('Posteingang').unreadCount).toBe(0);
    await settle(sync);

    expect(patches()).toHaveLength(26);
    expect(ids.every((id) => graph.find(id)!.isRead)).toBe(true);
    expect(graph.find(newest)!.flag).toEqual({ flagStatus: 'flagged' });
    expect(store.hasOperations(accountId)).toBe(false);

    now += 6 * MINUTE;
    await settle(sync);
    expect(stored('Posteingang').every((message) => message.isRead)).toBe(true);
    expect(folder('Posteingang').unreadCount).toBe(0);
  });

  it('sends a change right away instead of at the next check', async () => {
    const first = graph.addMessage(inbox);
    const second = graph.addMessage(inbox);
    const sync = createSync();
    const running = sync.run();
    await vi.waitFor(() => expect(sync.status().state).toBe('idle'));

    store.setRead([localId(first)], true);
    sync.wake();
    await vi.waitFor(() => expect(graph.find(first)!.isRead).toBe(true));

    // Also when the change comes while a step runs that ends in a wait, here after an error.
    graph.intercept = (url) => {
      if (!url.pathname.endsWith('/delta') || store.hasOperations(accountId)) return undefined;
      if (graph.find(second)!.isRead) return undefined;
      store.setRead([localId(second)], true);
      sync.wake();
      return new Response('{}', { status: 500 });
    };
    sync.syncNow();
    await vi.waitFor(() => expect(graph.find(second)!.isRead).toBe(true));
    sync.stop();
    await running;
  });

  it('keeps a change the server does not know yet, also in the counters', async () => {
    const id = graph.addMessage(inbox);
    graph.addMessage(inbox);
    const sync = createSync();
    await settle(sync);

    refuse(503);
    store.setRead([localId(id)], true);
    await sync.stepSafely();
    expect(store.hasOperations(accountId)).toBe(true);

    // The server reports the message again, still unread, and counts it so.
    graph.updateMessage(inbox, id, { subject: 'Changed' });
    now += 6 * MINUTE;
    await settle(sync);
    expect(store.getMessage(localId(id))).toMatchObject({ subject: 'Changed', isRead: true });
    expect(folder('Posteingang').unreadCount).toBe(1);

    graph.intercept = undefined;
    now += MINUTE;
    await settle(sync);
    expect(graph.find(id)!.isRead).toBe(true);
    expect(store.hasOperations(accountId)).toBe(false);
    expect(folder('Posteingang').unreadCount).toBe(1);
  });

  it('waits without a connection and sends after a restart, the last change of each kind', async () => {
    const id = graph.addMessage(inbox);
    await settle(createSync());
    const message = localId(id);

    graph.offline = true;
    store.setRead([message], true);
    store.setRead([message], false);
    store.setRead([message], true);
    store.setFlagged([message], true);
    const before = createSync();
    expect(await before.stepSafely()).toBeGreaterThan(0);
    expect(before.status().state).toBe('offline');
    expect(store.listDueOperations(accountId, now, 10)).toMatchObject([
      { kind: 'read', value: true, before: false },
      { kind: 'flag', value: true, before: false },
    ]);

    graph.offline = false;
    graph.requests.length = 0;
    await settle(createSync());
    expect(patches()).toHaveLength(2);
    expect(graph.find(id)).toMatchObject({ isRead: true, flag: { flagStatus: 'flagged' } });
    expect(store.getMessage(message)).toMatchObject({ isRead: true, isFlagged: true });
  });

  it('undoes a change the server refuses', async () => {
    const id = graph.addMessage(inbox);
    graph.addMessage(inbox);
    const sync = createSync();
    await settle(sync);

    refuse(403, 'ErrorAccessDenied');
    store.setRead([localId(id)], true);
    expect(folder('Posteingang').unreadCount).toBe(1);
    events = [];
    await sync.stepSafely();

    expect(store.getMessage(localId(id))!.isRead).toBe(false);
    expect(folder('Posteingang').unreadCount).toBe(2);
    expect(store.hasOperations(accountId)).toBe(false);
    expect(events).toEqual([`messages:${folder('Posteingang').id}`, 'folders']);
    expect(graph.find(id)!.isRead).toBe(false);
  });

  it('gives up a change after many tries that failed for a while', async () => {
    const id = graph.addMessage(inbox);
    const sync = createSync();
    await settle(sync);

    refuse(503);
    store.setFlagged([localId(id)], true);
    for (let round = 0; round < 10; round++) {
      now += 11 * MINUTE;
      await sync.stepSafely();
    }
    expect(store.hasOperations(accountId)).toBe(false);
    expect(store.getMessage(localId(id))!.isFlagged).toBe(false);
  });

  it('drops a change of a message that is gone at the server', async () => {
    const id = graph.addMessage(inbox);
    const sync = createSync();
    await settle(sync);

    graph.removeMessage(inbox, id);
    store.setRead([localId(id)], true);
    await sync.stepSafely();
    expect(store.hasOperations(accountId)).toBe(false);
    now += 31_000;
    await settle(sync);
    expect(stored('Posteingang')).toEqual([]);
  });

  it('sends a newer change that came in while the last one was on its way', async () => {
    const id = graph.addMessage(inbox);
    const sync = createSync();
    await settle(sync);
    const message = localId(id);

    // The user marks the message unread again while the server gets the first change.
    graph.intercept = (_url, method) => {
      if (method === 'PATCH' && patches().length === 1) store.setRead([message], false);
      return undefined;
    };
    store.setRead([message], true);
    await settle(sync);

    expect(patches()).toHaveLength(2);
    expect(graph.find(id)!.isRead).toBe(false);
    expect(store.getMessage(message)!.isRead).toBe(false);
    expect(store.hasOperations(accountId)).toBe(false);
  });
});

describe('moves made here', () => {
  const stored = (name: string) => store.listMessages(folder(name).id, 'all', 0, 500).messages;
  const idOf = (name: string, subject: string) =>
    stored(name).find((message) => message.subject === subject)!.id;
  const moves = () => graph.requests.filter((request) => request.endsWith('/move'));
  const counts = (name: string) => {
    const { totalCount, unreadCount } = folder(name);
    return [totalCount, unreadCount];
  };
  const refuseMoves = (status: number) => {
    graph.intercept = (_url, method) =>
      method === 'POST' && _url.pathname.endsWith('/move')
        ? new Response(JSON.stringify({ error: { code: 'Test', message: 'No' } }), { status })
        : undefined;
  };

  it('moves messages to another folder, and the server then reports them there', async () => {
    const ids = [
      graph.addMessage(inbox, { subject: 'One' }),
      graph.addMessage(inbox, { subject: 'Two', isRead: true }),
    ];
    graph.addMessage(inbox, { subject: 'Stays' });
    const sync = createSync();
    await settle(sync);

    const changed = store.moveMessages(
      [idOf('Posteingang', 'One'), idOf('Posteingang', 'Two')],
      folder('Projects').id,
    );
    expect(changed.sort()).toEqual([folder('Posteingang').id, folder('Projects').id].sort());
    expect(counts('Posteingang')).toEqual([1, 1]);
    expect(counts('Projects')).toEqual([2, 1]);
    await settle(sync);

    expect(moves()).toHaveLength(2);
    expect(ids.every((id) => graph.find(id) !== undefined)).toBe(true);
    now += 6 * MINUTE;
    await settle(sync);
    expect(subjects('Posteingang')).toEqual(['Stays']);
    expect(subjects('Projects').sort()).toEqual(['One', 'Two']);
    expect(counts('Projects')).toEqual([2, 1]);
    expect(store.hasOperations(accountId)).toBe(false);
  });

  it('keeps a moved message in its new folder while the server still has it in the old one', async () => {
    graph.addMessage(inbox, { subject: 'Moving' });
    graph.addMessage(inbox, { subject: 'Stays' });
    const sync = createSync();
    await settle(sync);

    refuseMoves(503);
    store.moveMessages([idOf('Posteingang', 'Moving')], folder('Projects').id);
    await sync.stepSafely();
    expect(store.hasOperations(accountId)).toBe(true);

    // Both folders are read from the start, and the folder list brings the server's counters.
    graph.expireSyncState();
    now += 6 * MINUTE;
    await settle(sync);
    expect(subjects('Posteingang')).toEqual(['Stays']);
    expect(subjects('Projects')).toEqual(['Moving']);
    expect(counts('Posteingang')).toEqual([1, 1]);
    expect(counts('Projects')).toEqual([1, 1]);

    graph.intercept = undefined;
    now += MINUTE;
    await settle(sync);
    now += 6 * MINUTE;
    await settle(sync);
    expect(moves().length).toBeGreaterThan(1);
    expect(subjects('Posteingang')).toEqual(['Stays']);
    expect(subjects('Projects')).toEqual(['Moving']);
    expect(store.hasOperations(accountId)).toBe(false);
  });

  it('moves a message back when the server refuses', async () => {
    graph.addMessage(inbox, { subject: 'Refused' });
    const sync = createSync();
    await settle(sync);

    refuseMoves(403);
    store.moveMessages([idOf('Posteingang', 'Refused')], folder('Projects').id);
    events = [];
    await sync.stepSafely();
    expect(subjects('Posteingang')).toEqual(['Refused']);
    expect(subjects('Projects')).toEqual([]);
    expect(counts('Posteingang')).toEqual([1, 1]);
    expect(counts('Projects')).toEqual([0, 0]);
    expect(events).toContain('folders');
  });

  it('sends nothing when a message is moved back before the first move was sent', async () => {
    graph.addMessage(inbox, { subject: 'Back' });
    const sync = createSync();
    await settle(sync);

    graph.offline = true;
    const message = idOf('Posteingang', 'Back');
    store.moveMessages([message], folder('Projects').id);
    store.moveMessages([message], folder('Posteingang').id);
    expect(store.hasOperations(accountId)).toBe(false);
    graph.offline = false;
    now += 6 * MINUTE;
    await settle(sync);
    expect(moves()).toEqual([]);
    expect(subjects('Posteingang')).toEqual(['Back']);
  });

  it('moves a message back and reads its folder again when the new folder is gone', async () => {
    const id = graph.addMessage(inbox, { subject: 'Lost' });
    const sync = createSync();
    await settle(sync);

    graph.removeFolder(projects);
    store.moveMessages([idOf('Posteingang', 'Lost')], folder('Projects').id);
    await sync.stepSafely();
    expect(subjects('Posteingang')).toEqual(['Lost']);
    expect(
      store.listSyncFolders(accountId).find((entry) => entry.remoteId === inbox)!.syncPending,
    ).toBe(1);
    await settle(sync);
    expect(subjects('Posteingang')).toEqual(['Lost']);
    expect(graph.find(id)).toBeDefined();
  });

  it('follows a message that gets a new ID when it moves', async () => {
    graph.newIdOnMove = true;
    graph.addMessage(inbox, { subject: 'Renamed' });
    const sync = createSync();
    await settle(sync);

    store.moveMessages([idOf('Posteingang', 'Renamed')], folder('Projects').id);
    await settle(sync);
    now += 6 * MINUTE;
    await settle(sync);
    expect(subjects('Projects')).toEqual(['Renamed']);
    expect(subjects('Posteingang')).toEqual([]);
  });

  it('deletes to Deleted Items and archives by role, within the account', async () => {
    graph.addFolder('Gelöschte Elemente', { wellKnown: 'deleteditems' });
    graph.addMessage(inbox, { subject: 'Old news' });
    graph.addMessage(inbox, { subject: 'Keep' });
    const sync = createSync();
    await settle(sync);

    const deleted = folder('Gelöschte Elemente').id;
    expect(store.moveToRole([idOf('Posteingang', 'Old news')], 'deleted')).toHaveLength(2);
    // Already there, and no archive folder in this mailbox: nothing happens.
    expect(store.moveToRole([idOf('Gelöschte Elemente', 'Old news')], 'deleted')).toEqual([]);
    expect(store.moveToRole([idOf('Posteingang', 'Keep')], 'archive')).toEqual([]);
    await settle(sync);
    now += 6 * MINUTE;
    await settle(sync);
    expect(subjects('Gelöschte Elemente')).toEqual(['Old news']);
    expect(subjects('Posteingang')).toEqual(['Keep']);
    expect(store.listMessages(deleted, 'all', 0, 10).total).toBe(1);
  });
});

describe('message texts', () => {
  const picture = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

  it('fetches the texts of recent mail ahead, newest first, and then comes to rest', async () => {
    const recent = (days: number) => new Date(now - days * 86_400_000).toISOString();
    const old = graph.addMessage(inbox, { subject: 'Old', receivedDateTime: recent(45) });
    const first = graph.addMessage(inbox, { subject: 'Newest', receivedDateTime: recent(1) });
    graph.addMessage(inbox, { subject: 'Recent', receivedDateTime: recent(20) });
    graph.setBody(first, 'text', 'Plain words');
    const sync = createSync();
    await settle(sync);

    const stored = (subject: string) => {
      const id = store.search(subject, 1)[0]!.id;
      return store.getMessage(id)!.body;
    };
    expect(stored('Newest')).toEqual({ contentType: 'text', content: 'Plain words' });
    expect(stored('Recent')?.contentType).toBe('html');
    expect(stored('Old')).toBeNull();
    expect(sync.status().state).toBe('idle');

    const texts = graph.requests.filter((request) => request.startsWith('GET /me/messages/'));
    expect(texts[0]).toBe(`GET /me/messages/${first}`);
    expect(texts).not.toContain(`GET /me/messages/${old}`);
  });

  it('stores attachments, and keeps the pictures that the text shows', async () => {
    const id = graph.addMessage(inbox, {
      subject: 'Pictures',
      receivedDateTime: new Date(now).toISOString(),
    });
    graph.setBody(id, 'html', '<p>Logo: <img src="cid:logo@x"> and <img src="cid:missing"></p>');
    graph.addAttachment(id, {
      name: 'logo.png',
      contentType: 'image/png',
      content: picture,
      isInline: true,
      contentId: '<logo@x>',
    });
    graph.addAttachment(id, {
      name: 'unused.png',
      contentType: 'image/png',
      content: picture,
      isInline: true,
      contentId: 'unused@x',
    });
    graph.addAttachment(id, {
      name: 'vector.svg',
      contentType: 'image/svg+xml',
      content: picture,
      isInline: true,
      contentId: 'missing',
    });
    graph.addAttachment(id, {
      name: 'report.pdf',
      contentType: 'application/pdf',
      content: picture,
    });
    graph.addAttachment(id, {
      name: 'cloud file',
      contentType: 'x',
      content: picture,
      type: 'referenceAttachment',
    });
    await settle(createSync());

    const message = store.getMessage(store.search('Pictures', 1)[0]!.id)!;
    expect(message.attachments.map((entry) => [entry.name, entry.contentId, entry.size])).toEqual([
      ['logo.png', 'logo@x', 7],
      ['unused.png', 'unused@x', 7],
      ['vector.svg', 'missing', 7],
      ['report.pdf', null, 7],
    ]);
    expect(message.inlineImages).toEqual([
      {
        contentId: 'logo@x',
        dataUrl: `data:image/png;base64,${Buffer.from(picture).toString('base64')}`,
      },
    ]);
    // Only the one picture that is shown was downloaded.
    expect(graph.requests.filter((request) => request.endsWith('/$value'))).toHaveLength(1);
  });

  it('does not ask for attachments when a message has none', async () => {
    const id = graph.addMessage(inbox, { receivedDateTime: new Date(now).toISOString() });
    await settle(createSync());
    expect(graph.requests).toContain(`GET /me/messages/${id}`);
    expect(graph.requests).not.toContain(`GET /me/messages/${id}/attachments`);
  });

  it('skips a text that cannot be fetched and goes on with the others', async () => {
    const broken = graph.addMessage(inbox, {
      subject: 'Broken',
      receivedDateTime: new Date(now).toISOString(),
    });
    graph.addMessage(inbox, {
      subject: 'Fine',
      receivedDateTime: new Date(now - 1000).toISOString(),
    });
    graph.intercept = (url) =>
      url.pathname.endsWith(`/messages/${broken}`)
        ? new Response(JSON.stringify({ error: { code: 'ErrorItemNotFound', message: 'Gone' } }), {
            status: 404,
          })
        : undefined;
    const sync = createSync();
    await settle(sync);
    expect(sync.status().state).toBe('idle');
    expect(store.getMessage(store.search('Fine', 1)[0]!.id)!.body).not.toBeNull();
    expect(
      graph.requests.filter((request) => request.endsWith(`/messages/${broken}`)),
    ).toHaveLength(1);
  });

  it('fetches the text again when the message changed', async () => {
    const id = graph.addMessage(inbox, {
      subject: 'Draft',
      bodyPreview: 'First',
      receivedDateTime: new Date(now).toISOString(),
    });
    graph.setBody(id, 'text', 'First version');
    const sync = createSync();
    await settle(sync);

    graph.updateMessage(inbox, id, { bodyPreview: 'Second' });
    graph.setBody(id, 'text', 'Second version');
    now += 31_000;
    await settle(sync);
    expect(store.getMessage(store.search('Draft', 1)[0]!.id)!.body?.content).toBe('Second version');
  });
});

describe('log', () => {
  it('tells what the sync did and what went wrong, without anything personal', async () => {
    const lines: string[] = [];
    setUpLog({
      process: 'core',
      level: 'debug',
      home: '/home/tester',
      write: (line) => lines.push(line),
    });
    try {
      // Real IDs of Microsoft are long. They point to a mailbox and must not appear either.
      const remoteId = (index: number) => `AAMkAGI2TG93AAAuAAAAAAAiQ8W967B7TKBjgx9rVEURAQ${index}`;
      const person = { name: 'Petra Lang', address: 'petra.lang@private.example' };
      const recent = new Date(now - 86_400_000).toISOString();
      const taxes = graph.addFolder('Tax papers 2026');
      const letter = graph.addMessage(taxes, {
        id: remoteId(1),
        subject: 'Salary talk',
        bodyPreview: 'Please keep this between us',
        from: { emailAddress: person },
        receivedDateTime: recent,
        hasAttachments: true,
      });
      graph.setBody(letter, 'text', 'Please keep this between us');
      graph.addAttachment(letter, {
        name: 'Medical letter.pdf',
        contentType: 'application/pdf',
        content: new Uint8Array([1]),
      });
      graph.addMessage(inbox, {
        id: remoteId(2),
        subject: 'Salary talk',
        from: { emailAddress: person },
      });
      token = async () => 'eyJhbGciOiJSUzI1NiJ9.c2VjcmV0LXRva2Vu.c2lnbmF0dXJl';

      // Once the server asks to wait. Later it refuses, naming the folder and the person.
      let requests = 0;
      graph.intercept = () =>
        ++requests === 3
          ? new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })
          : undefined;
      const sync = createSync();
      await settle(sync);
      const [unread] = store.listMessages(folder('Posteingang').id, 'all', 0, 10).messages;
      store.setRead([unread!.id], true);
      graph.intercept = () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'ErrorAccessDenied',
              message: `Access to 'Tax papers 2026' of ${person.address} (${person.name}) is denied`,
            },
          }),
          { status: 403 },
        );
      now += 6 * MINUTE;
      await sync.stepSafely();
      await sync.stepSafely();
      expect(sync.status().state).toBe('error');

      const text = lines.join('\n');
      expect(text).toContain('Microsoft Graph asked to wait');
      expect(text).toContain('Read a page of a folder');
      expect(text).toMatch(/A change was refused and undone here .*code=ErrorAccessDenied/);
      expect(text).toMatch(
        /The sync stopped account=\d+ state=error before=idle .*code=ErrorAccessDenied/,
      );
      for (const line of text.split('\n'))
        expect(line).toMatch(new RegExp(`${LOG_LINE.source}|^ {4}at `));
      const secrets = [
        'Petra',
        'petra.lang',
        'private.example',
        'Tax papers',
        'Salary',
        'Medical',
        'between us',
        'AAMkAGI2TG93',
        'c2VjcmV0',
        '/home/',
      ];
      for (const secret of secrets) expect(text).not.toContain(secret);
    } finally {
      setUpLog(undefined);
    }
  });
});

describe('drafts written here', () => {
  const anna = { name: 'Anna Berg', address: 'anna@remote.example' };
  const content = (text: string, subject = 'Plans') => ({
    to: [anna],
    cc: [],
    bcc: [{ name: '', address: 'boss@remote.example' }],
    subject,
    text,
  });
  const posts = () => graph.requests.filter((request) => request === 'POST /me/messages');
  const patches = () => graph.requests.filter((request) => request.startsWith('PATCH '));
  const remoteIdOf = (id: number) => store.getRemoteMessage(id)?.remoteId;
  const refuse = (status: number, test: (url: URL, method: string) => boolean) => {
    graph.intercept = (url, method) =>
      test(url, method)
        ? new Response(JSON.stringify({ error: { code: 'Test', message: 'No' } }), { status })
        : undefined;
  };

  beforeEach(() => {
    graph.addFolder('Gelöschte Elemente', { wellKnown: 'deleteditems' });
  });

  it('makes a draft at the provider once it has text, and saves later versions over it', async () => {
    const sync = createSync();
    await settle(sync);
    const { id } = store.createDraft({ kind: 'new', accountId })!;
    await settle(sync);
    expect(posts()).toEqual([]);

    store.saveDraft(id, content('<p>Hi Anna</p>'));
    await settle(sync);
    expect(posts()).toHaveLength(1);
    const remoteId = remoteIdOf(id)!;
    expect(graph.find(remoteId)).toMatchObject({
      subject: 'Plans',
      toRecipients: [{ emailAddress: anna }],
    });
    expect(graph.bccOf(remoteId)).toEqual([{ emailAddress: { address: 'boss@remote.example' } }]);
    expect(graph.body(remoteId)!.content).toContain('<p style="margin: 0">Hi Anna</p>');

    store.saveDraft(id, content('<p>Hi Anna, see you</p>'));
    await settle(sync);
    expect(patches()).toEqual([`PATCH /me/messages/${remoteId}`]);
    expect(graph.body(remoteId)!.content).toContain('see you');

    // The check of the Drafts folder finds the same draft, not a second one.
    now += 6 * MINUTE;
    await settle(sync);
    const listed = store.listMessages(folder('Entwürfe').id, 'all', 0, 10).messages;
    expect(listed).toMatchObject([{ id, subject: 'Plans', isDraft: true }]);
    expect(store.hasDraftsToSend(accountId)).toBe(false);
  });

  it('keeps a draft while offline and makes it when the connection is back', async () => {
    const sync = createSync();
    await settle(sync);
    const { id } = store.createDraft({ kind: 'new', accountId })!;
    store.saveDraft(id, content('<p>Written offline</p>'));
    graph.offline = true;
    await sync.stepSafely();
    expect(sync.status().state).toBe('offline');

    graph.offline = false;
    now += MINUTE;
    await settle(sync);
    expect(graph.body(remoteIdOf(id)!)!.content).toContain('Written offline');
  });

  it('answers in the conversation of the message, with what the user wrote meanwhile', async () => {
    const source = graph.addMessage(inbox, { subject: 'Plans', from: { emailAddress: anna } });
    const sync = createSync();
    await settle(sync);
    const [sourceMessage] = store.listMessages(folder('Posteingang').id, 'all', 0, 10).messages;
    const { id } = store.createDraft({ kind: 'reply', messageId: sourceMessage!.id })!;
    expect(store.getDraft(id)).toMatchObject({ subject: 'RE: Plans', to: [anna] });

    store.saveDraft(id, content('<p>First</p>', 'RE: Plans'));
    // While the provider makes the answer, the user writes on.
    graph.intercept = (url) => {
      if (url.pathname.endsWith('/createReply')) {
        graph.intercept = undefined;
        store.saveDraft(id, content('<p>Second</p>', 'RE: Plans'));
      }
      return undefined;
    };
    await settle(sync);
    const remoteId = remoteIdOf(id)!;
    expect(graph.requests).toContain(`POST /me/messages/${source}/createReply`);
    expect(posts()).toEqual([]);
    expect(graph.find(remoteId)!.conversationId).toBe(`conversation-${source}`);
    expect(graph.body(remoteId)!.content).toContain('Second');
    expect(graph.body(remoteId)!.content).toContain('<b>From:</b> Anna Berg');
    expect(store.hasDraftsToSend(accountId)).toBe(false);
  });

  it('makes an answer on its own when the message it answers is gone there', async () => {
    const source = graph.addMessage(inbox, { subject: 'Plans' });
    const sync = createSync();
    await settle(sync);
    const [sourceMessage] = store.listMessages(folder('Posteingang').id, 'all', 0, 10).messages;
    graph.removeMessage(inbox, source);
    const { id } = store.createDraft({ kind: 'replyAll', messageId: sourceMessage!.id })!;
    store.saveDraft(id, content('<p>Still here</p>', 'RE: Plans'));
    await settle(sync);
    expect(posts()).toHaveLength(1);
    expect(graph.body(remoteIdOf(id)!)!.content).toContain('Still here');
  });

  it('does not let the sync undo or remove a draft the provider does not have as it is here', async () => {
    const sync = createSync();
    await settle(sync);
    const first = store.createDraft({ kind: 'new', accountId })!.id;
    store.saveDraft(first, content('<p>Saved</p>', 'Saved'));
    await settle(sync);
    const remoteId = remoteIdOf(first)!;

    refuse(503, (_url, method) => method !== 'GET');
    const second = store.createDraft({ kind: 'new', accountId })!.id;
    store.saveDraft(second, content('<p>Waiting</p>', 'Waiting'));
    store.saveDraft(first, content('<p>Newer</p>', 'Newer'));
    // Open in the editor, nothing written yet.
    const empty = store.createDraft({ kind: 'new', accountId })!.id;
    // Meanwhile the server reports its older version, and its Drafts folder is read again.
    graph.updateMessage(drafts, remoteId, { subject: 'Older elsewhere' });
    graph.expireSyncState();
    now += 6 * MINUTE;
    await settle(sync);
    expect(subjects('Entwürfe').sort()).toEqual(['', 'Newer', 'Waiting']);
    expect(folder('Entwürfe').totalCount).toBe(3);
    store.closeDraft(empty);

    graph.intercept = undefined;
    now += 11 * MINUTE;
    await settle(sync);
    expect(graph.find(remoteId)!.subject).toBe('Newer');
    expect(graph.find(remoteIdOf(second)!)!.subject).toBe('Waiting');
    now += 6 * MINUTE;
    await settle(sync);
    expect(subjects('Entwürfe').sort()).toEqual(['Newer', 'Waiting']);
  });

  it('makes a draft again that was sent or deleted elsewhere while the user wrote here', async () => {
    const sync = createSync();
    await settle(sync);
    const { id } = store.createDraft({ kind: 'new', accountId })!;
    store.saveDraft(id, content('<p>One</p>'));
    await settle(sync);
    const before = remoteIdOf(id)!;

    graph.removeMessage(drafts, before);
    store.saveDraft(id, content('<p>Two</p>'));
    // The server reports it gone before the new version reaches it.
    refuse(503, (_url, method) => method === 'PATCH');
    now += 6 * MINUTE;
    await settle(sync);
    expect(subjects('Entwürfe')).toEqual(['Plans']);
    graph.intercept = undefined;
    now += MINUTE;
    await settle(sync);
    const after = remoteIdOf(id)!;
    expect(after).not.toBe(before);
    expect(graph.body(after)!.content).toContain('Two');
    now += 6 * MINUTE;
    await settle(sync);
    expect(subjects('Entwürfe')).toEqual(['Plans']);
  });

  it('throws drafts away: to Deleted Items there, for good when the provider never had them', async () => {
    const sync = createSync();
    await settle(sync);
    const kept = store.createDraft({ kind: 'new', accountId })!.id;
    store.saveDraft(kept, content('<p>Kept</p>', 'Kept'));
    await settle(sync);
    const remoteId = remoteIdOf(kept)!;

    graph.offline = true;
    const never = store.createDraft({ kind: 'new', accountId })!.id;
    store.saveDraft(never, content('<p>Never</p>', 'Never'));
    store.discardDraft(kept);
    store.discardDraft(never);
    expect(subjects('Entwürfe')).toEqual([]);
    expect(subjects('Gelöschte Elemente')).toEqual(['Kept']);
    expect(store.getMessage(kept)!.isDraft).toBe(false);

    graph.offline = false;
    now += MINUTE;
    await settle(sync);
    expect(graph.requests).toContain(`POST /me/messages/${remoteId}/move`);
    expect(posts()).toHaveLength(1);
  });

  it('sends a draft thrown away while it was being made to Deleted Items there too', async () => {
    const sync = createSync();
    await settle(sync);
    const { id } = store.createDraft({ kind: 'new', accountId })!;
    store.saveDraft(id, content('<p>Gone soon</p>'));
    graph.intercept = (url, method) => {
      if (method === 'POST' && url.pathname.endsWith('/me/messages')) {
        graph.intercept = undefined;
        store.discardDraft(id);
      }
      return undefined;
    };
    await settle(sync);
    expect(graph.requests.filter((request) => request.endsWith('/move'))).toHaveLength(1);

    now += 6 * MINUTE;
    await settle(sync);
    expect(subjects('Entwürfe')).toEqual([]);
    expect(subjects('Gelöschte Elemente')).toEqual(['Plans']);
  });

  it('moves a draft there that was moved here before the provider had it', async () => {
    const sync = createSync();
    await settle(sync);
    const { id } = store.createDraft({ kind: 'new', accountId })!;
    store.saveDraft(id, content('<p>Filed</p>'));
    store.moveMessages([id], folder('Projects').id);
    await settle(sync);
    expect(graph.requests).toContain(`POST /me/messages/${remoteIdOf(id)}/move`);

    now += 6 * MINUTE;
    await settle(sync);
    expect(subjects('Projects')).toEqual(['Plans']);
    expect(subjects('Entwürfe')).toEqual([]);
  });

  it('tries a refused draft again later and keeps its text meanwhile', async () => {
    const sync = createSync();
    await settle(sync);
    const { id } = store.createDraft({ kind: 'new', accountId })!;
    store.saveDraft(id, content('<p>Stubborn</p>'));
    refuse(400, (_url, method) => method === 'POST');
    await settle(sync);
    expect(store.nextDraftAt(accountId)).toBe(now + 15_000);
    now += 15_000;
    await settle(sync);
    expect(store.nextDraftAt(accountId)).toBe(now + 30_000);
    expect(store.getDraft(id)!.text).toBe('<p>Stubborn</p>');

    graph.intercept = undefined;
    now += 30_000;
    await settle(sync);
    expect(graph.body(remoteIdOf(id)!)!.content).toContain('Stubborn');
  });
});
