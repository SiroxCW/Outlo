import { useCallback, useEffect, useState } from 'react';

export interface Settings {
  get(key: string, fallback: string): string;
  set(key: string, value: string): void;
}

// Settings of the interface. They are stored by the core, so they survive a restart.
export function useSettings(): Settings | undefined {
  const [values, setValues] = useState<Record<string, string>>();

  useEffect(() => {
    let active = true;
    void window.outlo.request('settings.get', undefined).then((loaded) => {
      if (active) setValues(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  const set = useCallback((key: string, value: string) => {
    const stored = `ui.${key}`;
    setValues((current) => ({ ...current, [stored]: value }));
    void window.outlo.request('settings.set', { key: stored, value });
  }, []);

  if (!values) return undefined;
  return { get: (key, fallback) => values[`ui.${key}`] ?? fallback, set };
}
