import { readFileSync, writeFileSync } from 'node:fs';
import type { ICachePlugin } from '@azure/msal-node';

export interface Encryption {
  encrypt(text: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<string>;
}

// Keeps the sign-ins of MSAL in one encrypted file. Without it every start would need a new login.
export function createCachePlugin(file: string, encryption: Encryption): ICachePlugin {
  return {
    async beforeCacheAccess(context) {
      try {
        context.tokenCache.deserialize(await encryption.decrypt(readFileSync(file)));
      } catch {
        // No file yet, or it cannot be decrypted any more (new keyring). Start without sign-ins.
      }
    },
    async afterCacheAccess(context) {
      if (!context.cacheHasChanged) return;
      const data = await encryption.encrypt(context.tokenCache.serialize());
      writeFileSync(file, data, { mode: 0o600 });
    },
  };
}
