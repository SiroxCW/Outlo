import type { Endpoint } from './rpc';

export interface MemoryEndpoint extends Endpoint {
  close(): void;
}

// Two connected endpoints in one process, for tests. Messages are copied like on a real port.
export function createEndpointPair(): [MemoryEndpoint, MemoryEndpoint] {
  const listeners: [((message: unknown) => void)[], ((message: unknown) => void)[]] = [[], []];
  const closers: [(() => void)[], (() => void)[]] = [[], []];

  const side = (own: 0 | 1): MemoryEndpoint => {
    const other = own === 0 ? 1 : 0;
    return {
      post: (message) => {
        const copy = structuredClone(message);
        queueMicrotask(() => listeners[other].forEach((listener) => listener(copy)));
      },
      listen: (handler) => listeners[own].push(handler),
      onClose: (handler) => closers[own].push(handler),
      close: () => closers[other].forEach((handler) => handler()),
    };
  };
  return [side(0), side(1)];
}
