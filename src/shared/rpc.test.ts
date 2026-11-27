import { describe, expect, it } from 'vitest';
import { createEndpointPair } from './memory-endpoint';
import { createClient, createServer } from './rpc';

type TestRequests = {
  add: { params: { a: number; b: number }; result: number };
  fail: { params: undefined; result: never };
  slow: { params: number; result: number };
};

type TestEvents = {
  changed: { ids: number[] };
  reset: undefined;
};

function setup() {
  const server = createServer<TestRequests, TestEvents>({
    add: ({ a, b }) => a + b,
    fail: () => {
      throw new Error('broken');
    },
    slow: (value) => new Promise((resolve) => setTimeout(() => resolve(value), 5)),
  });
  const [uiSide, coreSide] = createEndpointPair();
  server.connect(coreSide);
  return { server, uiSide, client: createClient<TestRequests, TestEvents>(uiSide) };
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('requests', () => {
  it('returns the result of a handler', async () => {
    const { client } = setup();
    await expect(client.request('add', { a: 2, b: 3 })).resolves.toBe(5);
  });

  it('rejects with the message of a failing handler', async () => {
    const { client } = setup();
    await expect(client.request('fail', undefined)).rejects.toThrow('broken');
  });

  it('matches answers to requests when they arrive out of order', async () => {
    const { client } = setup();
    const results = await Promise.all([
      client.request('slow', 1),
      client.request('add', { a: 1, b: 1 }),
    ]);
    expect(results).toEqual([1, 2]);
  });

  it('rejects an unknown method, including names inherited from Object', async () => {
    const { uiSide } = setup();
    const client = createClient<Record<string, { params: undefined; result: unknown }>>(uiSide);
    await expect(client.request('missing', undefined)).rejects.toThrow('Unknown method: missing');
    await expect(client.request('toString', undefined)).rejects.toThrow('Unknown method');
  });

  it('ignores messages that are not requests', async () => {
    const { client, uiSide } = setup();
    uiSide.post('garbage');
    uiSide.post({ id: 'x', method: 5 });
    uiSide.post(null);
    await expect(client.request('add', { a: 1, b: 2 })).resolves.toBe(3);
  });
});

describe('events', () => {
  it('delivers an event to every connected client', async () => {
    const { server, client } = setup();
    const [secondUi, secondCore] = createEndpointPair();
    server.connect(secondCore);
    const second = createClient<TestRequests, TestEvents>(secondUi);

    const seen: unknown[] = [];
    client.subscribe((event) => seen.push(['first', event]));
    second.subscribe((event) => seen.push(['second', event]));
    server.emit('changed', { ids: [1, 2] });
    await nextTick();

    expect(seen).toEqual([
      ['first', { type: 'changed', payload: { ids: [1, 2] } }],
      ['second', { type: 'changed', payload: { ids: [1, 2] } }],
    ]);
  });

  it('stops delivering after unsubscribe', async () => {
    const { server, client } = setup();
    const seen: unknown[] = [];
    const unsubscribe = client.subscribe((event) => seen.push(event.type));
    server.emit('reset', undefined);
    await nextTick();
    unsubscribe();
    server.emit('reset', undefined);
    await nextTick();
    expect(seen).toEqual(['reset']);
  });

  it('forgets a client whose connection was closed', async () => {
    const { server, uiSide, client } = setup();
    const seen: unknown[] = [];
    client.subscribe((event) => seen.push(event.type));
    uiSide.close();
    server.emit('reset', undefined);
    await nextTick();
    expect(seen).toEqual([]);
  });

  it('does not mistake an event for an answer', async () => {
    const { server, client } = setup();
    const pending = client.request('slow', 7);
    server.emit('changed', { ids: [1] });
    await expect(pending).resolves.toBe(7);
  });
});
