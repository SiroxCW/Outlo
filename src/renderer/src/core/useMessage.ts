import { useCallback, useEffect, useState } from 'react';
import type { Message } from '@shared/api';
import { useCoreEvents } from './events';

// The full message for the reading pane. Undefined while loading, null when it does not exist.
export function useMessage(id: number | undefined): Message | null | undefined {
  const [loaded, setLoaded] = useState<{ id: number; message: Message | null }>();

  const load = useCallback(() => {
    if (id === undefined) return;
    void window.outlo.request('messages.get', { id }).then((message) => setLoaded({ id, message }));
  }, [id]);

  useEffect(load, [load]);
  useCoreEvents((event) => event.type === 'messages.changed', load);

  return loaded?.id === id ? loaded?.message : undefined;
}
