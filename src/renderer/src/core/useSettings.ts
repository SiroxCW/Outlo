import { useCallback, useEffect, useState } from 'react';

export interface Settings {
  get(key: string, fallback: string): string;
  set(key: string, value: string): void;
}

// Settings of the interface. They are stored by the core, so they survive a restart.
export function useSettings(): Settings | undefined {
  const [values, setValues] = useState<Record<string, string>>();

  useEffect(() => {
    void window.outlo.request('settings.get', undefined).then(setValues);
  }, []);

  const set = useCallback((key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    void window.outlo.request('settings.set', { key: `ui.${key}`, value });
  }, []);

  if (!values) return undefined;
  return { get: (key, fallback) => values[`ui.${key}`] ?? values[key] ?? fallback, set };
}
