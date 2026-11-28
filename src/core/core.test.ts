import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  CoreEvent,
  CoreEvents,
  CoreRequests,
  HostRequests,
  HostServices,
  TokenResult,
} from '@shared/api';
import { createEndpointPair } from '@shared/memory-endpoint';
import { createClient, createServer } from '@shared/rpc';
import { createCore } from './core';
import { FakeGraph } from './sync/fake-graph';

const DEMO = { largeFolderSize: 300, otherFolderSize: 40, batchSize: 100 };
const cores: ReturnType<typeof createCore>[] = [];
afterEach(() => cores.splice(0).forEach((core) => core.close()));

function start() {
  const core = createCore({ databasePath: ':memory:', demo: DEMO });
  cores.push(core);
  const [uiSide, coreSide] = createEndpointPair();
  core.connect(coreSide);
  const client = createClient<CoreRequests, CoreEvents>(uiSide);
  const events: CoreEvent[] = [];
  client.subscribe((event) => events.push(event));
  // The contract types are for the UI. Tests also send what the types forbid.
  const raw = client.request as (method: string, params: unknown) => Promise<unknown>;
  return { core, client, events, raw };
}

async function startSeeded() {
  const context = start();
  await context.core.seedDemoData();
  const folders = await context.client.request('folders.list', undefined);
  const inbox = folders.find((folder) => folder.role === 'inbox')!;
  return { ...context, folders, inbox };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('core', () => {
  it('answers queries while the demo data is still arriving, and announces every batch', async () => {
    const { core, client, events } = start();
    const seeding = core.seedDemoData();

    const early = await client.request('folders.list', undefined);
    expect(early.length).toBeGreaterThan(0);
    const earlyTotal = early.reduce((sum, folder) => sum + folder.totalCount, 0);

    await seeding;
    await settle();
    const late = await client.request('folders.list', undefined);
    const lateTotal = late.reduce((sum, folder) => sum + folder.totalCount, 0);
    expect(lateTotal).toBeGreaterThan(earlyTotal);

    const batches = events.filter((event) => event.type === 'messages.changed');
    expect(batches).toHaveLength(Math.ceil(lateTotal / DEMO.batchSize));
    expect(events.some((event) => event.type === 'accounts.changed')).toBe(true);
  });

  it('does not create the demo data a second time', async () => {
    const { core, client } = await startSeeded();
    const before = await client.request('folders.list', undefined);
    await core.seedDemoData();
    expect(await client.request('folders.list', undefined)).toEqual(before);
  });

  it('serves a page of messages', async () => {
    const { client, inbox } = await startSeeded();
    const page = await client.request('messages.list', {
      folderId: inbox.id,
      filter: 'all',
      offset: 10,
      limit: 20,
    });
    expect(page.total).toBe(inbox.totalCount);
    expect(page.messages).toHaveLength(20);
  });

  it('filters and sorts a list, with groups that add up to it', async () => {
    const { client, inbox } = await startSeeded();
    const query = {
      folderId: inbox.id,
      filter: 'all',
      show: 'unread',
      sort: { field: 'from', descending: false },
    } as const;
    const groups = await client.request('messages.countByGroup', query);
    const page = await client.request('messages.list', { ...query, offset: 0, limit: 500 });
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(page.total);
    expect(page.total).toBe(inbox.unreadCount);
    expect(page.messages.every((message) => !message.isRead)).toBe(true);
  });

  it('creates the body of a demo message when it is first opened and keeps it', async () => {
    const { client, inbox } = await startSeeded();
    const [summary] = (
      await client.request('messages.list', {
        folderId: inbox.id,
        filter: 'all',
        offset: 0,
        limit: 1,
      })
    ).messages;
    const first = await client.request('messages.get', { id: summary!.id });
    expect(first?.body?.content).toContain('<p>');
    expect(await client.request('messages.get', { id: summary!.id })).toEqual(first);
    expect(await client.request('messages.get', { id: 9_999_999 })).toBeNull();
  });

  it('marks a message as read, updates the counter and tells the UI', async () => {
    const { client, inbox, events } = await startSeeded();
    const page = await client.request('messages.list', {
      folderId: inbox.id,
      filter: 'all',
      offset: 0,
      limit: 50,
    });
    const unread = page.messages.find((message) => !message.isRead)!;
    await settle();
    events.length = 0;

    await client.request('messages.setRead', { ids: [unread.id], isRead: true });
    await settle();

    const folders = await client.request('folders.list', undefined);
    expect(folders.find((folder) => folder.id === inbox.id)!.unreadCount).toBe(
      inbox.unreadCount - 1,
    );
    expect(events).toEqual([
      { type: 'messages.changed', payload: { folderIds: [inbox.id] } },
      { type: 'folders.changed', payload: undefined },
    ]);
  });

  it('stays silent when a command changes nothing', async () => {
    const { client, events } = await startSeeded();
    await settle();
    events.length = 0;
    await client.request('messages.setFlagged', { ids: [9_999_999], isFlagged: true });
    await settle();
    expect(events).toEqual([]);
  });

  it('finds messages through search', async () => {
    const { client } = await startSeeded();
    const found = await client.request('messages.search', { query: 'meeting', limit: 5 });
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(5);
  });

  it('rejects requests with wrong or oversized parameters', async () => {
    const { raw, inbox } = await startSeeded();
    const list = (params: object) =>
      raw('messages.list', { folderId: inbox.id, filter: 'all', offset: 0, limit: 10, ...params });

    await expect(list({ limit: 100_000 })).rejects.toThrow('limit');
    await expect(list({ limit: 0 })).rejects.toThrow('limit');
    await expect(list({ offset: -1 })).rejects.toThrow('offset');
    await expect(list({ folderId: '1; DROP TABLE messages' })).rejects.toThrow('folderId');
    await expect(list({ filter: "all' OR 1=1" })).rejects.toThrow('filter');
    await expect(list({ show: 'everything' })).rejects.toThrow('show');
    await expect(list({ sort: 'date' })).rejects.toThrow('sort');
    await expect(list({ sort: { field: 'size', descending: true } })).rejects.toThrow('sort.field');
    await expect(list({ sort: { field: 'date', descending: 'yes' } })).rejects.toThrow(
      'sort.descending',
    );
    await expect(list({ keepId: -1 })).rejects.toThrow('keepId');
    await expect(raw('messages.list', null)).rejects.toThrow('params');
    await expect(raw('messages.get', { id: 1.5 })).rejects.toThrow('id');
    await expect(raw('messages.setRead', { ids: 'all', isRead: true })).rejects.toThrow('ids');
    await expect(raw('messages.setRead', { ids: [1], isRead: 'yes' })).rejects.toThrow('isRead');
    await expect(raw('messages.search', { query: 'x'.repeat(300), limit: 5 })).rejects.toThrow(
      'query',
    );
    // The database is still intact afterwards.
    await expect(list({})).resolves.toMatchObject({ total: inbox.totalCount });
  });
});

describe('settings', () => {
  it('stores settings of the user interface and announces the change', async () => {
    const { client, events } = start();
    await client.request('settings.set', { key: 'ui.theme', value: 'dark' });
    await settle();
    expect(await client.request('settings.get', undefined)).toEqual({ 'ui.theme': 'dark' });
    expect(events).toContainEqual({ type: 'settings.changed', payload: undefined });
  });

  it('refuses keys outside of the user interface settings', async () => {
    const { client, raw } = start();
    await expect(raw('settings.set', { key: 'demo.seeded', value: '1' })).rejects.toThrow('ui.');
    await expect(raw('settings.set', { key: 'ui.x y', value: '1' })).rejects.toThrow('ui.');
    expect(await client.request('settings.get', undefined)).toEqual({});
  });
});

describe('accounts through the main process', () => {
  function startWithHost() {
    const context = start();
    const [hostSide, coreSide] = createEndpointPair();
    context.core.connectHost(coreSide);
    const host = createClient<HostRequests>(hostSide);
    return { ...context, host };
  }
  const account = {
    provider: 'graph',
    remoteId: 'home-1',
    email: 'a@b.example',
    displayName: 'A B',
  } as const;

  it('adds an account once and tells the UI', async () => {
    const { host, client, events } = startWithHost();
    const first = await host.request('accounts.add', account);
    const again = await host.request('accounts.add', { ...account, displayName: 'Changed' });
    await settle();
    expect(again).toEqual(first);
    expect(await client.request('accounts.list', undefined)).toEqual([
      { id: first.id, provider: 'graph', email: 'a@b.example', displayName: 'A B' },
    ]);
    expect(events).toContainEqual({ type: 'accounts.changed', payload: undefined });
  });

  it('puts a new account after the existing ones', async () => {
    const { host, client } = startWithHost();
    await host.request('accounts.add', account);
    await host.request('accounts.add', { ...account, remoteId: 'home-2', email: 'c@d.example' });
    const emails = (await client.request('accounts.list', undefined)).map((entry) => entry.email);
    expect(emails).toEqual(['a@b.example', 'c@d.example']);
  });

  it('removes an account and returns its ID at the provider', async () => {
    const { host, client } = startWithHost();
    const { id } = await host.request('accounts.add', account);
    expect(await host.request('accounts.remove', { id })).toEqual({
      provider: 'graph',
      remoteId: 'home-1',
    });
    expect(await client.request('accounts.list', undefined)).toEqual([]);
    expect(await host.request('accounts.remove', { id })).toEqual({
      provider: null,
      remoteId: null,
    });
  });

  it('keeps accounts in web mode out of the mail sync', async () => {
    const { host, client } = startWithHost();
    const web = {
      provider: 'web',
      remoteId: 'partition-1',
      email: 'me@company.example',
      displayName: 'me@company.example',
    } as const;
    const { id } = await host.request('accounts.add', web);
    await host.request('accounts.add', account);

    expect(await host.request('accounts.listRemote', { provider: 'web' })).toEqual([
      { id, remoteId: 'partition-1', email: 'me@company.example' },
    ]);
    expect(
      (await client.request('accounts.list', undefined)).map((entry) => entry.provider),
    ).toEqual(['web', 'graph']);
    expect(await host.request('accounts.remove', { id })).toEqual({
      provider: 'web',
      remoteId: 'partition-1',
    });
  });

  it('does not offer these methods to the UI', async () => {
    const { raw } = startWithHost();
    await expect(raw('accounts.add', account)).rejects.toThrow('Unknown method');
    await expect(raw('accounts.remove', { id: 1 })).rejects.toThrow('Unknown method');
  });
});

describe('mail sync', () => {
  async function startWithGraph(tokenStatus: TokenResult['status'] = 'ok') {
    const graph = new FakeGraph();
    const inbox = graph.addFolder('Inbox', { wellKnown: 'inbox' });
    graph.addMessage(inbox, { subject: 'From the server' });

    const core = createCore({ databasePath: ':memory:', fetch: graph.fetch });
    cores.push(core);
    const [uiSide, coreSide] = createEndpointPair();
    core.connect(coreSide);
    const client = createClient<CoreRequests, CoreEvents>(uiSide);
    const events: CoreEvent[] = [];
    client.subscribe((event) => events.push(event));

    const [hostSide, hostCoreSide] = createEndpointPair();
    core.connectHost(hostCoreSide);
    const host = createClient<HostRequests>(hostSide);

    const asked: HostServices['auth.getToken']['params'][] = [];
    const [serviceSide, serviceCoreSide] = createEndpointPair();
    createServer<HostServices, Record<string, never>>({
      'auth.getToken': (params) => {
        asked.push(params);
        return tokenStatus === 'ok'
          ? { status: 'ok', accessToken: 'secret-token', expiresAt: Date.now() + 3_600_000 }
          : ({ status: tokenStatus } as TokenResult);
      },
    }).connect(serviceSide);
    core.connectServices(serviceCoreSide);

    const waitFor = async (state: string) => {
      for (let tries = 0; tries < 200; tries++) {
        const [status] = await client.request('sync.status', undefined);
        if (status?.state === state) return;
        await settle();
      }
      throw new Error(`The sync never reached the state ${state}`);
    };
    return { graph, inbox, client, host, events, asked, waitFor };
  }
  const account = {
    provider: 'graph',
    remoteId: 'home-1',
    email: 'a@b.example',
    displayName: 'A',
  } as const;

  it('starts when an account is added and brings in folders and headers', async () => {
    const { client, host, events, asked, waitFor } = await startWithGraph();
    expect(await client.request('sync.status', undefined)).toEqual([]);

    const { id } = await host.request('accounts.add', account);
    await waitFor('idle');

    const folders = await client.request('folders.list', undefined);
    expect(folders).toMatchObject([
      { accountId: id, name: 'Inbox', role: 'inbox', unreadCount: 1 },
    ]);
    const page = await client.request('messages.list', {
      folderId: folders[0]!.id,
      filter: 'all',
      offset: 0,
      limit: 10,
    });
    expect(page.messages.map((message) => message.subject)).toEqual(['From the server']);

    // One token is enough for all requests, and it is asked for by the ID of the account.
    expect(asked).toEqual([{ remoteId: 'home-1', forceRefresh: false }]);
    const types = events.map((event) => event.type);
    expect(types).toContain('folders.changed');
    expect(types).toContain('messages.changed');
    expect(events.findLast((event) => event.type === 'sync.changed')?.payload).toEqual([
      { accountId: id, state: 'idle', message: null },
    ]);
    expect(JSON.stringify(events)).not.toContain('secret-token');
  });

  it('opens a synced message without inventing a text for it', async () => {
    const { client, host, waitFor } = await startWithGraph();
    await host.request('accounts.add', account);
    await waitFor('idle');
    const [folder] = await client.request('folders.list', undefined);
    const page = await client.request('messages.list', {
      folderId: folder!.id,
      filter: 'all',
      offset: 0,
      limit: 1,
    });
    const message = await client.request('messages.get', { id: page.messages[0]!.id });
    expect(message).toMatchObject({ subject: 'From the server', body: null, attachments: [] });
  });

  it('reports an account whose sign-in no longer works', async () => {
    const context = await startWithGraph('signInNeeded');
    await context.host.request('accounts.add', account);
    await context.waitFor('signInNeeded');
    expect(await context.client.request('folders.list', undefined)).toEqual([]);
  });

  it('stops the sync of a removed account', async () => {
    const { graph, client, host, waitFor } = await startWithGraph();
    const { id } = await host.request('accounts.add', account);
    await waitFor('idle');
    await host.request('accounts.remove', { id });
    expect(await client.request('sync.status', undefined)).toEqual([]);
    expect(await client.request('folders.list', undefined)).toEqual([]);

    const before = graph.requests.length;
    await client.request('sync.now', undefined);
    await settle();
    expect(graph.requests).toHaveLength(before);
  });
});

describe('message texts and attachments', () => {
  const picture = new Uint8Array([137, 80, 78, 71, 9]);
  const account = {
    provider: 'graph',
    remoteId: 'home-1',
    email: 'a@b.example',
    displayName: 'A',
  } as const;

  async function startWithMail(html: string) {
    const graph = new FakeGraph();
    const inbox = graph.addFolder('Inbox', { wellKnown: 'inbox' });
    // Old enough that the text is not fetched ahead, so the test decides when it is.
    const remoteId = graph.addMessage(inbox, {
      subject: 'Old mail',
      receivedDateTime: '2020-01-01T00:00:00Z',
    });
    graph.setBody(remoteId, 'html', html);

    const loaded: string[] = [];
    const core = createCore({
      databasePath: ':memory:',
      fetch: graph.fetch,
      loadImage: async (url) => {
        loaded.push(url);
        return { contentType: 'image/png', data: picture };
      },
    });
    cores.push(core);
    const [uiSide, coreSide] = createEndpointPair();
    core.connect(coreSide);
    const client = createClient<CoreRequests, CoreEvents>(uiSide);
    const [hostSide, hostCoreSide] = createEndpointPair();
    core.connectHost(hostCoreSide);
    const host = createClient<HostRequests>(hostSide);
    const [serviceSide, serviceCoreSide] = createEndpointPair();
    createServer<HostServices, Record<string, never>>({
      'auth.getToken': () => ({
        status: 'ok',
        accessToken: 't',
        expiresAt: Date.now() + 3_600_000,
      }),
    }).connect(serviceSide);
    core.connectServices(serviceCoreSide);

    await host.request('accounts.add', account);
    for (let tries = 0; ; tries++) {
      const [status] = await client.request('sync.status', undefined);
      if (status?.state === 'idle') break;
      if (tries > 200) throw new Error('The sync did not finish');
      await settle();
    }
    const [folder] = await client.request('folders.list', undefined);
    const page = await client.request('messages.list', {
      folderId: folder!.id,
      filter: 'all',
      offset: 0,
      limit: 1,
    });
    return { graph, client, host, remoteId, id: page.messages[0]!.id, loaded };
  }

  it('loads the text when asked, and only once', async () => {
    const { graph, client, id, remoteId } = await startWithMail('<p>Hello</p>');
    expect((await client.request('messages.get', { id }))?.body).toBeNull();

    const [first, second] = await Promise.all([
      client.request('messages.loadBody', { id }),
      client.request('messages.loadBody', { id }),
    ]);
    expect(first?.body).toEqual({ contentType: 'html', content: '<p>Hello</p>' });
    expect(second?.body).toEqual(first?.body);
    await client.request('messages.loadBody', { id });
    expect(
      graph.requests.filter((request) => request === `GET /me/messages/${remoteId}`),
    ).toHaveLength(1);
    expect((await client.request('messages.get', { id }))?.body).not.toBeNull();
  });

  it('reports when the text cannot be loaded', async () => {
    const { graph, client, id } = await startWithMail('<p>Hello</p>');
    graph.offline = true;
    await expect(client.request('messages.loadBody', { id })).rejects.toThrow();
    expect(await client.request('messages.loadBody', { id: 9999 })).toBeNull();
  });

  it('fetches internet pictures only for addresses that occur in the message', async () => {
    const html =
      '<img src="https://news.example.com/a.png?x=1&amp;y=2"><img src="http://192.168.0.1/b.png">';
    const { client, id, loaded } = await startWithMail(html);
    expect(
      await client.request('images.fetch', {
        messageId: id,
        urls: ['https://news.example.com/a.png?x=1&y=2'],
      }),
    ).toEqual({});

    await client.request('messages.loadBody', { id });
    const result = await client.request('images.fetch', {
      messageId: id,
      urls: [
        'https://news.example.com/a.png?x=1&y=2',
        'https://other.example.com/not-in-the-mail.png',
        'http://192.168.0.1/b.png',
      ],
    });
    expect(Object.keys(result)).toEqual(['https://news.example.com/a.png?x=1&y=2']);
    expect(loaded).toEqual(['https://news.example.com/a.png?x=1&y=2']);
  });

  it('writes attachments to the file the main process names', async () => {
    const { graph, client, host, id, remoteId } = await startWithMail('<img src="cid:logo">');
    const large = new Uint8Array(300_000).map((_, index) => index % 251);
    graph.addAttachment(remoteId, {
      name: 'logo.png',
      contentType: 'image/png',
      content: picture,
      isInline: true,
      contentId: 'logo',
    });
    graph.addAttachment(remoteId, {
      name: 'data.bin',
      contentType: 'application/octet-stream',
      content: large,
    });
    const message = await client.request('messages.loadBody', { id });
    const [logo, data] = message!.attachments;

    expect(await host.request('attachments.info', { id: data!.id })).toEqual({
      name: 'data.bin',
      size: 300_000,
      contentType: 'application/octet-stream',
    });
    expect(await host.request('attachments.info', { id: 9999 })).toBeNull();

    const directory = mkdtempSync(join(tmpdir(), 'outlo-attachments-'));
    try {
      await host.request('attachments.download', {
        id: data!.id,
        path: join(directory, 'data.bin'),
      });
      await host.request('attachments.download', {
        id: logo!.id,
        path: join(directory, 'logo.png'),
      });
      expect(readFileSync(join(directory, 'data.bin')).equals(Buffer.from(large))).toBe(true);
      expect(readFileSync(join(directory, 'logo.png')).equals(Buffer.from(picture))).toBe(true);
      expect(statSync(join(directory, 'data.bin')).mode & 0o777).toBe(0o600);

      graph.offline = true;
      const failed = join(directory, 'failed.bin');
      await expect(
        host.request('attachments.download', { id: data!.id, path: failed }),
      ).rejects.toThrow();
      expect(existsSync(failed)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not offer attachment files to the UI', async () => {
    const { client } = await startWithMail('<p>x</p>');
    const raw = client.request as (method: string, params: unknown) => Promise<unknown>;
    await expect(raw('attachments.download', { id: 1, path: '/tmp/x' })).rejects.toThrow(
      'Unknown method',
    );
  });
});
