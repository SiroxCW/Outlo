import { createLog } from '@shared/log';
import type { MailStore } from './store';

const log = createLog('text-index');

// Raise this when bodyText changes, so texts stored before are indexed again.
export const TEXT_INDEX_VERSION = '1';
const VERSION_SETTING = 'search.textVersion';
const BATCH_SIZE = 100;

// Puts texts that were stored before into the search index, a batch at a time, so requests are
// answered meanwhile. Texts stored from now on are indexed when they are saved.
export function indexStoredTexts(store: MailStore, isClosed: () => boolean): Promise<void> {
  if (store.getSetting(VERSION_SETTING) === TEXT_INDEX_VERSION) return Promise.resolve();
  // A run that was interrupted, or one of an older version, starts again from nothing.
  store.clearTextIndex();

  const started = performance.now();
  let count = 0;
  let lastId = 0;
  return new Promise((resolve, reject) => {
    const step = () => {
      if (isClosed()) return resolve();
      try {
        const batch = store.listBodies(lastId, BATCH_SIZE);
        store.transaction(() => {
          for (const { messageId, body } of batch) store.indexBody(messageId, body);
        });
        count += batch.length;
        if (batch.length < BATCH_SIZE) {
          store.setSetting(VERSION_SETTING, TEXT_INDEX_VERSION);
          log.info('Indexed the stored texts', {
            texts: count,
            ms: Math.round(performance.now() - started),
          });
          return resolve();
        }
        lastId = batch.at(-1)!.messageId;
        setImmediate(step);
      } catch (error) {
        reject(error as Error);
      }
    };
    setImmediate(step);
  });
}
