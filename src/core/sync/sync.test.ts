import { beforeEach, describe, expect, it } from 'vitest';
import type { Folder } from '@shared/api';
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
  graph.addFolder('Entwürfe', { wellKnown: 'drafts' });
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

  it('does not let the user change synced mail yet', async () => {
    graph.addMessage(inbox);
    await settle(createSync());
    const [message] = store.listMessages(folder('Posteingang').id, 'all', 0, 10).messages;
    expect(store.setRead([message!.id], true)).toEqual([]);
    expect(store.setFlagged([message!.id], true)).toEqual([]);
    expect(store.getMessage(message!.id)).toMatchObject({ isRead: false, isFlagged: false });
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
