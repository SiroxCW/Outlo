import { useEffect, useRef } from 'react';
import type { CoreEvent } from '@shared/api';

const REFRESH_INTERVAL = 250;

// Calls onEvent for core events that pass the test, at most once per interval. While data
// arrives in many small batches, the interface then refreshes a few times per second, not hundreds.
export function useCoreEvents(test: (event: CoreEvent) => boolean, onEvent: () => void): void {
  const latest = useRef({ test, onEvent });
  useEffect(() => {
    latest.current = { test, onEvent };
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.outlo.subscribe((event) => {
      if (!latest.current.test(event) || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        latest.current.onEvent();
      }, REFRESH_INTERVAL);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);
}
