import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@shared/api';
import { useCoreEvents } from './events';

export interface OpenMessage {
  // Undefined while loading, null when the message does not exist.
  message: Message | null | undefined;
  // The text of a message can arrive after its header: it is fetched from the mail provider.
  textState: 'ready' | 'loading' | 'failed';
  retryText(): void;
}

// The full message for the reading pane.
export function useMessage(id: number | undefined): OpenMessage {
  const [loaded, setLoaded] = useState<{ id: number; message: Message | null }>();
  const [text, setText] = useState<{ id: number; state: 'loading' | 'failed' | 'done' }>();
  const asked = useRef<number>(undefined);

  const load = useCallback(() => {
    if (id === undefined) return;
    void window.outlo.request('messages.get', { id }).then((message) => setLoaded({ id, message }));
  }, [id]);
  useEffect(load, [load]);
  useCoreEvents((event) => event.type === 'messages.changed', load);

  const loadText = useCallback(() => {
    if (id === undefined) return;
    setText({ id, state: 'loading' });
    window.outlo.request('messages.loadBody', { id }).then(
      (message) => {
        setLoaded((current) => (current?.id === id ? { id, message } : current));
        setText({ id, state: 'done' });
      },
      () => setText({ id, state: 'failed' }),
    );
  }, [id]);

  const message = loaded?.id === id ? loaded?.message : undefined;
  const missing = message !== undefined && message !== null && message.body === null;
  // Ask once per message. After a failure the user decides when to try again.
  useEffect(() => {
    if (!missing || asked.current === id) return;
    asked.current = id;
    loadText();
  }, [missing, id, loadText]);

  const state = text && text.id === id ? text.state : undefined;
  return {
    message,
    textState: !missing || state === 'done' ? 'ready' : state === 'failed' ? 'failed' : 'loading',
    retryText: loadText,
  };
}
