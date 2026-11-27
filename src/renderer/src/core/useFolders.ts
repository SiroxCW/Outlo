import { useCallback, useEffect, useState } from 'react';
import type { Account, Folder } from '@shared/api';
import { useCoreEvents } from './events';

export interface Mailboxes {
  accounts: Account[];
  folders: Folder[];
}

export function useMailboxes(): { mailboxes: Mailboxes | undefined; error: string | undefined } {
  const [mailboxes, setMailboxes] = useState<Mailboxes>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    Promise.all([
      window.outlo.request('accounts.list', undefined),
      window.outlo.request('folders.list', undefined),
    ])
      .then(([accounts, folders]) => setMailboxes({ accounts, folders }))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(load, [load]);
  useCoreEvents(
    (event) => event.type === 'accounts.changed' || event.type === 'folders.changed',
    load,
  );
  return { mailboxes, error };
}
