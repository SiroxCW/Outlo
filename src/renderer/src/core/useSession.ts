import { useEffect, useState } from 'react';
import type { SessionInfo } from '@shared/api';

export function useSession(): SessionInfo | undefined {
  const [info, setInfo] = useState<SessionInfo>();
  useEffect(() => {
    void window.outlo.session.getInfo().then(setInfo);
  }, []);
  return info;
}
