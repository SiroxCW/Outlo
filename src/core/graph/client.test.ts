import { describe, expect, it } from 'vitest';
import { GraphClient, GraphError, OfflineError, SignInNeededError, type Fetch } from './client';

const ok = (body: unknown = { ok: true }) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, headers: Record<string, string> = {}, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function setup(answers: (Response | Error | (() => Promise<Response>))[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const waits: number[] = [];
  const tokens: boolean[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    const answer = answers.shift() ?? ok();
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer() : answer;
  };
  const client = new GraphClient({
    fetch,
    getToken: async (force) => {
      tokens.push(force);
      return force ? 'new-token' : 'token';
    },
    sleep: async (ms) => void waits.push(ms),
  });
  return { client, calls, waits, tokens };
}
const headers = (call: { init: RequestInit }) => call.init.headers as Record<string, string>;

describe('GraphClient', () => {
  it('signs the request and asks for immutable IDs', async () => {
    const { client, calls } = setup([ok({ value: 1 })]);
    expect(await client.request('/me/mailFolders', { maxPageSize: 50 })).toEqual({ value: 1 });
    expect(calls[0]!.url).toBe('https://graph.microsoft.com/v1.0/me/mailFolders');
    expect(headers(calls[0]!).Authorization).toBe('Bearer token');
    expect(headers(calls[0]!).Prefer).toBe('IdType="ImmutableId", odata.maxpagesize=50');
  });

  it('uses a complete address from an earlier answer as it is', async () => {
    const { client, calls } = setup([]);
    await client.request('https://graph.microsoft.com/v1.0/me/x?$skiptoken=abc');
    expect(calls[0]!.url).toBe('https://graph.microsoft.com/v1.0/me/x?$skiptoken=abc');
  });

  it('never sends the token to another server', async () => {
    const { client, calls, tokens } = setup([]);
    for (const address of [
      'https://graph.microsoft.com.evil.example/v1.0/me',
      'https://evil.example/?https://graph.microsoft.com/',
      'http://graph.microsoft.com/v1.0/me',
      'me/messages',
    ]) {
      await expect(client.request(address)).rejects.toMatchObject({ code: 'ForeignAddress' });
    }
    expect(calls).toEqual([]);
    expect(tokens).toEqual([]);
  });

  it('sends a body as JSON', async () => {
    const { client, calls } = setup([]);
    await client.request('/$batch', { method: 'POST', body: { requests: [] } });
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBe('{"requests":[]}');
    expect(headers(calls[0]!)['Content-Type']).toBe('application/json');
  });

  it('waits as long as the server asks and tries again', async () => {
    const { client, waits, calls } = setup([fail(429, { 'Retry-After': '7' }), fail(503), ok()]);
    await client.request('/me');
    expect(waits).toEqual([7000, 2000]);
    expect(calls).toHaveLength(3);
  });

  it('never waits longer than five minutes', async () => {
    const { client, waits } = setup([fail(429, { 'Retry-After': '86400' }), ok()]);
    await client.request('/me');
    expect(waits).toEqual([300_000]);
  });

  it('gives up after five attempts', async () => {
    const busy = () => fail(503, {}, { error: { code: 'ServiceUnavailable', message: 'Busy' } });
    const { client, calls } = setup([busy(), busy(), busy(), busy(), busy()]);
    await expect(client.request('/me')).rejects.toMatchObject({ status: 503, message: 'Busy' });
    expect(calls).toHaveLength(5);
  });

  it('does not retry errors that will not go away', async () => {
    const { client, calls } = setup([
      fail(404, {}, { error: { code: 'ErrorItemNotFound', message: 'Not there' } }),
    ]);
    const error = await client.request('/me').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(GraphError);
    expect(error).toMatchObject({ status: 404, code: 'ErrorItemNotFound' });
    expect(calls).toHaveLength(1);
  });

  it('gets a new token once when the server rejects the current one', async () => {
    const { client, tokens, calls } = setup([fail(401), ok()]);
    await client.request('/me');
    expect(tokens).toEqual([false, true, false]);
    expect(calls).toHaveLength(2);
  });

  it('reports that a sign-in is needed when the new token is rejected too', async () => {
    const { client } = setup([fail(401), fail(401)]);
    await expect(client.request('/me')).rejects.toBeInstanceOf(SignInNeededError);
  });

  it('reports a missing connection as its own error', async () => {
    const { client } = setup([new TypeError('fetch failed')]);
    await expect(client.request('/me')).rejects.toBeInstanceOf(OfflineError);
  });

  it('runs at most four requests at the same time', async () => {
    let running = 0;
    let most = 0;
    const slow = async () => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return ok();
    };
    const { client } = setup(Array.from({ length: 12 }, () => slow));
    await Promise.all(Array.from({ length: 12 }, () => client.request('/me')));
    expect(most).toBe(4);
  });
});
