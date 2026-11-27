import { useSyncExternalStore } from 'react';

const query = window.matchMedia('(prefers-color-scheme: dark)');

function subscribe(onChange: () => void): () => void {
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function useSystemDarkMode(): boolean {
  return useSyncExternalStore(subscribe, () => query.matches);
}
