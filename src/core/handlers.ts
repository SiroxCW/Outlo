import type { CoreRequests } from '@shared/api';
import type { Handlers } from '@shared/rpc';

const startedAt = Date.now();

export const handlers: Handlers<CoreRequests> = {
  'core.info': () => ({
    pid: process.pid,
    startedAt,
    nodeVersion: process.versions.node,
  }),
};
