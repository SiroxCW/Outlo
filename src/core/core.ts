import {
  MAX_PAGE_SIZE,
  MAX_TIME_BOUNDARIES,
  type CoreEvents,
  type CoreRequests,
  type MessageFilter,
} from '@shared/api';
import { createServer, type Endpoint } from '@shared/rpc';
import { openDatabase } from './db/database';
import { createDemoBody } from './demo/body';
import { DEFAULT_DEMO_OPTIONS, DemoSeeder, type DemoOptions } from './demo/seeder';
import { MailStore } from './mail/store';
import * as check from './validate';

const FILTERS: readonly MessageFilter[] = ['all', 'focused', 'other'];
const MAX_IDS_PER_COMMAND = 10_000;
const DEMO_SEEDED = 'demo.seeded';
const UI_SETTINGS = 'ui.';

export interface CoreOptions {
  databasePath: string;
  demo?: Partial<DemoOptions>;
}

// The core without any Electron code, so tests can run it under plain Node.
export function createCore(options: CoreOptions) {
  const startedAt = Date.now();
  const db = openDatabase(options.databasePath);
  const store = new MailStore(db);
  let closed = false;
  let seeding: Promise<void> = Promise.resolve();

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
      );
    },

    'messages.countByTime': (params) => {
      const input = check.record(params, 'params');
      return store.countByTime(
        check.id(input.folderId, 'folderId'),
        check.oneOf(input.filter, 'filter', FILTERS),
        check.timestamps(input.boundaries, 'boundaries', MAX_TIME_BOUNDARIES),
      );
    },

    'messages.get': (params) => {
      const messageId = check.id(check.record(params, 'params').id, 'id');
      const message = store.getMessage(messageId);
      if (!message || message.body) return message;

      // Headers first, bodies later: a body is fetched when the message is opened.
      if (store.getAccount(message.accountId)?.provider === 'demo') {
        const { body, attachments } = createDemoBody(message);
        store.saveBody(messageId, body, attachments);
        return store.getMessage(messageId);
      }
      return message;
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
    seedDemoData,
    close(): void {
      closed = true;
      db.close();
    },
  };
}
