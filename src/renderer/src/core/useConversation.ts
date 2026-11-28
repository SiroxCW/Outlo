import { useCallback, useEffect, useState } from 'react';
import type { MessageSummary } from '@shared/api';
import { useCoreEvents } from './events';

// The messages of the conversation a message belongs to, newest first, as seen from the folder
// of that message. Undefined while loading.
export function useConversation(
  messageId: number | undefined,
  folderId: number | undefined,
): MessageSummary[] | undefined {
  const [loaded, setLoaded] = useState<{ messageId: number; messages: MessageSummary[] }>();

  const load = useCallback(() => {
    if (messageId === undefined || folderId === undefined) return;
    window.outlo
      .request('conversations.get', { messageId, folderId })
      .then((messages) => setLoaded({ messageId, messages }))
      .catch(() => undefined);
  }, [messageId, folderId]);
  useEffect(load, [load]);
  useCoreEvents((event) => event.type === 'messages.changed', load);

  return loaded && loaded.messageId === messageId ? loaded.messages : undefined;
}
