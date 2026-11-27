import { describe, expect, it } from 'vitest';
import { createClient, serve, type Endpoint } from './rpc';

type TestRequests = {
  add: { params: { a: number; b: number }; result: number };
  fail: { params: undefined; result: never };
  slow: { params: number; result: number };
};

function createPair(): [Endpoint, Endpoint] {
  const listeners: [((message: unknown) => void)[], ((message: unknown) => void)[]] = [[], []];
  const side = (own: 0 | 1): Endpoint => ({
    post: (message) => {
      const copy = structuredClone(message);
      queueMicrotask(() => listeners[own === 0 ? 1 : 0].forEach((listener) => listener(copy)));
    },
    listen: (handler) => listeners[own].push(handler),
  });
  return [side(0), side(1)];
}

function setup() {
  const [uiSide, coreSide] = createPair();
  serve<TestRequests>(coreSide, {
    add: ({ a, b }) => a + b,
    fail: () => {
      throw new Error('broken');
    },
    slow: (value) => new Promise((resolve) => setTimeout(() => resolve(value), 5)),
  });
  return { request: createClient<TestRequests>(uiSide), uiSide, coreSide };
}

describe('rpc', () => {
  it('returns the result of a handler', async () => {
    const { request } = setup();
    await expect(request('add', { a: 2, b: 3 })).resolves.toBe(5);
  });

  it('rejects with the message of a failing handler', async () => {
    const { request } = setup();
    await expect(request('fail', undefined)).rejects.toThrow('broken');
  });

  it('matches answers to requests when they arrive out of order', async () => {
    const { request } = setup();
    const results = await Promise.all([request('slow', 1), request('add', { a: 1, b: 1 })]);
    expect(results).toEqual([1, 2]);
  });

  it('rejects an unknown method, including names inherited from Object', async () => {
    const { uiSide } = setup();
    const request = createClient<Record<string, { params: undefined; result: unknown }>>(uiSide);
    await expect(request('missing', undefined)).rejects.toThrow('Unknown method: missing');
    await expect(request('toString', undefined)).rejects.toThrow('Unknown method: toString');
  });

  it('ignores messages that are not requests', async () => {
    const { request, uiSide } = setup();
    uiSide.post('garbage');
    uiSide.post({ id: 'x', method: 5 });
    uiSide.post(null);
    await expect(request('add', { a: 1, b: 2 })).resolves.toBe(3);
  });
});
