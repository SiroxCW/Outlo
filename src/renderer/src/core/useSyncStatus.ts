import { useEffect, useState } from 'react';
import type { AccountSyncStatus } from '@shared/api';

// The sync state of every account, kept current by the events of the core.
export function useSyncStatus(): AccountSyncStatus[] {
  const [status, setStatus] = useState<AccountSyncStatus[]>([]);
  useEffect(() => {
    void window.outlo.request('sync.status', undefined).then(setStatus);
    return window.outlo.subscribe((event) => {
      if (event.type === 'sync.changed') setStatus(event.payload);
    });
  }, []);
  return status;
}
