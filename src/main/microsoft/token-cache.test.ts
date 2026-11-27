import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TokenCacheContext } from '@azure/msal-node';
import { afterEach, describe, expect, it } from 'vitest';
import { createCachePlugin, type Encryption } from './token-cache';

// Reversible stand-in for the keyring encryption of Electron.
const encryption: Encryption = {
  encrypt: async (text) => Buffer.from(`locked:${Buffer.from(text).toString('base64')}`),
  decrypt: async (data) => {
    const text = data.toString();
    if (!text.startsWith('locked:')) throw new Error('cannot decrypt');
    return Buffer.from(text.slice(7), 'base64').toString();
  },
};

function context(serialized: string, changed: boolean) {
  const loaded: string[] = [];
  return {
    loaded,
    value: {
      cacheHasChanged: changed,
      tokenCache: { serialize: () => serialized, deserialize: (text: string) => loaded.push(text) },
    } as unknown as TokenCacheContext,
  };
}

let directory: string | undefined;
afterEach(() => directory && rmSync(directory, { recursive: true, force: true }));
const file = () => join((directory = mkdtempSync(join(tmpdir(), 'outlo-cache-'))), 'sign-ins.bin');

describe('createCachePlugin', () => {
  it('writes the sign-ins encrypted and readable only by the user', async () => {
    const path = file();
    await createCachePlugin(path, encryption).afterCacheAccess(
      context('{"secret":"token"}', true).value,
    );
    expect(readFileSync(path, 'utf8')).not.toContain('token');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('reads back what it wrote', async () => {
    const path = file();
    const plugin = createCachePlugin(path, encryption);
    await plugin.afterCacheAccess(context('{"secret":"token"}', true).value);
    const next = context('', false);
    await plugin.beforeCacheAccess(next.value);
    expect(next.loaded).toEqual(['{"secret":"token"}']);
  });

  it('does not write when nothing changed', async () => {
    const path = file();
    await createCachePlugin(path, encryption).afterCacheAccess(context('x', false).value);
    expect(() => readFileSync(path)).toThrow();
  });

  it('starts empty when there is no file or it cannot be decrypted', async () => {
    const path = file();
    const plugin = createCachePlugin(path, encryption);
    const first = context('', false);
    await plugin.beforeCacheAccess(first.value);
    expect(first.loaded).toEqual([]);

    await createCachePlugin(path, {
      ...encryption,
      encrypt: async (text) => Buffer.from(text),
    }).afterCacheAccess(context('plain', true).value);
    const second = context('', false);
    await plugin.beforeCacheAccess(second.value);
    expect(second.loaded).toEqual([]);
  });
});
