import { afterEach, describe, expect, it } from 'vitest';
import type { CoreEvent, CoreEvents, CoreRequests } from '@shared/api';
import { createEndpointPair } from '@shared/memory-endpoint';
import { createClient } from '@shared/rpc';
import { createCore } from './core';

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
