import { writeFile } from 'node:fs/promises';
import {
  MAX_IMAGE_URLS,
  MAX_PAGE_SIZE,
  MAX_TIME_BOUNDARIES,
  type CoreEvents,
  type CoreRequests,
  type HostRequests,
  type HostServices,
  type ListFilter,
  type ListOptions,
  type MessageFilter,
  type SortField,
} from '@shared/api';
import { createClient, createServer, type Endpoint } from '@shared/rpc';
import { openDatabase } from './db/database';
import { createDemoBody } from './demo/body';
import { DEFAULT_DEMO_OPTIONS, DemoSeeder, type DemoOptions } from './demo/seeder';
import type { Fetch } from './graph/client';
import { RemoteImages, type ImageLoader } from './mail/remote-images';
import { MailStore } from './mail/store';
import { SyncEngine } from './sync/engine';
import * as check from './validate';

const FILTERS: readonly MessageFilter[] = ['all', 'focused', 'other'];
const LIST_FILTERS: readonly ListFilter[] = ['all', 'unread', 'flagged', 'toMe', 'hasFiles'];
const SORT_FIELDS: readonly SortField[] = ['date', 'from', 'subject', 'importance', 'flag'];
const MAX_IDS_PER_COMMAND = 10_000;
const DEMO_SEEDED = 'demo.seeded';
const UI_SETTINGS = 'ui.';

export interface CoreOptions {
  databasePath: string;
  demo?: Partial<DemoOptions>;
  // How the core reaches mail servers. Electron's network stack in the app, a fake in tests.
  fetch?: Fetch;
  // How pictures from the internet are fetched. Without it none are.
  loadImage?: ImageLoader;
}

// The optional filter and sort of a message list. Fields that are left out keep their default.
function listOptions(input: Record<string, unknown>): ListOptions {
  const options: ListOptions = {};
  if (input.show !== undefined) options.show = check.oneOf(input.show, 'show', LIST_FILTERS);
  if (input.sort !== undefined) {
    const sort = check.record(input.sort, 'sort');
    options.sort = {
      field: check.oneOf(sort.field, 'sort.field', SORT_FIELDS),
      descending: check.boolean(sort.descending, 'sort.descending'),
    };
  }
  if (input.keepId !== undefined) options.keepId = check.id(input.keepId, 'keepId');
  return options;
}

// The core without any Electron code, so tests can run it under plain Node.
export function createCore(options: CoreOptions) {
  const startedAt = Date.now();
  const db = openDatabase(options.databasePath);
  const store = new MailStore(db);
  let closed = false;
  let seeding: Promise<void> = Promise.resolve();
  let engine: SyncEngine | undefined;
  const remoteImages = options.loadImage ? new RemoteImages(options.loadImage) : undefined;

  // Headers first, bodies later: the text of a demo message is made up when it is opened.
  function getMessage(messageId: number) {
    const message = store.getMessage(messageId);
    if (!message || message.body) return message;
    if (store.getAccount(message.accountId)?.provider !== 'demo') return message;
    const { body, attachments } = createDemoBody(message);
    store.saveBody(messageId, body, attachments);
    return store.getMessage(messageId);
  }

  const server = createServer<CoreRequests, CoreEvents>({
    'core.info': () => ({ pid: process.pid, startedAt, nodeVersion: process.versions.node }),

    'accounts.list': () => store.listAccounts(),
    'folders.list': () => store.listFolders(),

    'messages.list': (params) => {
      const input = check.record(params, 'params');
      return store.listMessages(
        check.id(input.folderId, 'folderId'),
        check.oneOf(input.filter, 'filter', FILTERS),
        check.integer(input.offset, 'offset', 0, Number.MAX_SAFE_INTEGER),
        check.integer(input.limit, 'limit', 1, MAX_PAGE_SIZE),
        listOptions(input),
      );
    },

    'messages.countByTime': (params) => {
      const input = check.record(params, 'params');
      return store.countByTime(
        check.id(input.folderId, 'folderId'),
        check.oneOf(input.filter, 'filter', FILTERS),
        check.timestamps(input.boundaries, 'boundaries', MAX_TIME_BOUNDARIES),
        listOptions(input),
      );
    },

    'messages.countByGroup': (params) => {
      const input = check.record(params, 'params');
      return store.countByGroup(
        check.id(input.folderId, 'folderId'),
        check.oneOf(input.filter, 'filter', FILTERS),
        listOptions(input),
      );
    },

    'messages.get': (params) => getMessage(check.id(check.record(params, 'params').id, 'id')),

    'messages.loadBody': async (params) => {
      const messageId = check.id(check.record(params, 'params').id, 'id');
      await engine?.loadBody(messageId);
      return getMessage(messageId);
    },

    'images.fetch': async (params) => {
      const input = check.record(params, 'params');
      const content = store.getBodyContent(check.id(input.messageId, 'messageId'));
      if (!remoteImages || content === null) return {};
      // The UI cannot use this to fetch arbitrary addresses: they have to occur in the message.
      const urls = check
        .textList(input.urls, 'urls', MAX_IMAGE_URLS, 4000)
        .filter((url) => content.includes(url) || content.includes(url.replaceAll('&', '&amp;')));
      return remoteImages.fetch(urls);
    },

    'messages.search': (params) => {
      const input = check.record(params, 'params');
      return store.search(
        check.text(input.query, 'query', 200),
        check.integer(input.limit, 'limit', 1, MAX_PAGE_SIZE),
      );
    },

    'messages.setRead': (params) => {
      const input = check.record(params, 'params');
      const folderIds = store.setRead(
        check.idList(input.ids, 'ids', MAX_IDS_PER_COMMAND),
        check.boolean(input.isRead, 'isRead'),
      );
      announce(folderIds, true);
      return undefined;
    },

    'messages.setFlagged': (params) => {
      const input = check.record(params, 'params');
      const folderIds = store.setFlagged(
        check.idList(input.ids, 'ids', MAX_IDS_PER_COMMAND),
        check.boolean(input.isFlagged, 'isFlagged'),
      );
      announce(folderIds, false);
      return undefined;
    },

    'sync.status': () => engine?.status() ?? [],
    'sync.now': () => {
      engine?.syncNow();
      return undefined;
    },

    'settings.get': () => store.listSettings(UI_SETTINGS),

    'settings.set': (params) => {
      const input = check.record(params, 'params');
      const key = check.text(input.key, 'key', 64);
      if (!/^ui\.[A-Za-z0-9.]+$/.test(key)) throw new Error('key must start with "ui."');
      store.setSetting(key, check.text(input.value, 'value', 2000));
      server.emit('settings.changed', undefined);
      return undefined;
    },
  });

  // Only the main process is connected to this one. The UI cannot call these methods.
  const hostServer = createServer<HostRequests, Record<string, never>>({
    'accounts.add': (params) => {
      const input = check.record(params, 'params');
      const id = store.addAccount(
        check.oneOf(input.provider, 'provider', ['graph', 'web'] as const),
        check.text(input.remoteId, 'remoteId', 200),
        check.text(input.email, 'email', 320),
        check.text(input.displayName, 'displayName', 200),
      );
      server.emit('accounts.changed', undefined);
      engine?.refresh();
      return { id };
    },

    'accounts.remove': (params) => {
      const removed = store.removeAccount(check.id(check.record(params, 'params').id, 'id'));
      server.emit('accounts.changed', undefined);
      server.emit('folders.changed', undefined);
      engine?.refresh();
      return removed ?? { provider: null, remoteId: null };
    },

    'accounts.listRemote': (params) => {
      const provider = check.text(check.record(params, 'params').provider, 'provider', 20);
      return store.listRemoteAccounts(provider);
    },

    'attachments.info': (params) => {
      const found = store.getAttachment(check.id(check.record(params, 'params').id, 'id'));
      return found && { name: found.name, size: found.size, contentType: found.contentType };
    },

    'attachments.download': async (params) => {
      const input = check.record(params, 'params');
      const id = check.id(input.id, 'id');
      const path = check.text(input.path, 'path', 4096);
      const attachment = store.getAttachment(id);
      if (!attachment) throw new Error('The attachment does not exist any more');
      // Never executable, and readable by the user only.
      if (attachment.content) await writeFile(path, attachment.content, { mode: 0o600 });
      else if (engine) await engine.downloadAttachment(attachment, path);
      else throw new Error('This attachment has no content that could be saved');
      return undefined;
    },
  });

  function announce(folderIds: number[], countsChanged: boolean): void {
    if (folderIds.length === 0) return;
    server.emit('messages.changed', { folderIds });
    if (countsChanged) server.emit('folders.changed', undefined);
  }

  // Fills an empty database with demo data. Runs in batches, so requests are answered meanwhile.
  function seedDemoData(): Promise<void> {
    if (store.getSetting(DEMO_SEEDED) === '1') return seeding;
    // A run that was interrupted leaves half a data set behind. Start again from nothing.
    store.deleteAllAccounts();

    const seeder = new DemoSeeder(store, {
      ...DEFAULT_DEMO_OPTIONS,
      now: Date.now(),
      ...options.demo,
    });
    seeder.seedStructure();
    server.emit('accounts.changed', undefined);
    server.emit('folders.changed', undefined);

    seeding = new Promise((resolve, reject) => {
      const step = () => {
        if (closed) return resolve();
        try {
          const folderIds = seeder.seedNextBatch();
          if (!folderIds) {
            store.setSetting(DEMO_SEEDED, '1');
            return resolve();
          }
          announce(folderIds, true);
          setImmediate(step);
        } catch (error) {
          reject(error as Error);
        }
      };
      setImmediate(step);
    });
    return seeding;
  }

  return {
    connect: (endpoint: Endpoint) => server.connect(endpoint),
    connectHost: (endpoint: Endpoint) => hostServer.connect(endpoint),

    // The line on which the core asks the main process for access tokens. The mail sync
    // starts once it is there.
    connectServices(endpoint: Endpoint): void {
      if (engine || closed) return;
      const host = createClient<HostServices>(endpoint);
      engine = new SyncEngine({
        store,
        fetch: options.fetch ?? ((url, init) => fetch(url, init)),
        requestHost: (method, params) => host.request(method, params),
        events: {
          foldersChanged: () => server.emit('folders.changed', undefined),
          messagesChanged: (folderIds) => server.emit('messages.changed', { folderIds }),
          statusChanged: () => engine && server.emit('sync.changed', engine.status()),
        },
      });
      engine.refresh();
    },

    seedDemoData,
    close(): void {
      closed = true;
      engine?.stop();
      db.close();
    },
  };
}
