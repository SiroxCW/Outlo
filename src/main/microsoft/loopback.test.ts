import { describe, expect, it } from 'vitest';
import { classifyRedirectError, listenForRedirect, SignInAborted } from './loopback';

const get = (url: string) =>
  fetch(url).then(async (response) => [response.status, await response.text()] as const);

describe('listenForRedirect', () => {
  it('waits on a free local port and hands out the code', async () => {
    const loopback = await listenForRedirect('s1', 5_000);
    expect(loopback.redirectUri).toMatch(/^http:\/\/localhost:\d+$/);
    const [status, page] = await get(`${loopback.redirectUri}/?code=abc&state=s1`);
    expect(status).toBe(200);
    expect(page).toContain('You are signed in');
    await expect(loopback.redirect).resolves.toEqual({ code: 'abc' });
  });

  it('reports the error Microsoft sends back', async () => {
    const loopback = await listenForRedirect('s2', 5_000);
    const query =
      'error=access_denied&error_description=AADSTS65004%3A+declined&error_subcode=cancel&state=s2';
    const [status, page] = await get(`${loopback.redirectUri}/?${query}`);
    expect(status).toBe(200);
    expect(page).toContain('did not work');
    await expect(loopback.redirect).resolves.toEqual({
      error: 'access_denied',
      description: 'AADSTS65004: declined',
      subcode: 'cancel',
    });
  });

  it('ignores answers with a wrong state or path and keeps waiting', async () => {
    const loopback = await listenForRedirect('right', 5_000);
    expect((await get(`${loopback.redirectUri}/?code=stolen&state=wrong`))[0]).toBe(404);
    expect((await get(`${loopback.redirectUri}/?code=stolen`))[0]).toBe(404);
    expect((await get(`${loopback.redirectUri}/favicon.ico?state=right`))[0]).toBe(404);
    await get(`${loopback.redirectUri}/?code=real&state=right`);
    await expect(loopback.redirect).resolves.toEqual({ code: 'real' });
  });

  it('stops listening after the first answer', async () => {
    const loopback = await listenForRedirect('s3', 5_000);
    await get(`${loopback.redirectUri}/?code=abc&state=s3`);
    await loopback.redirect;
    await expect(get(`${loopback.redirectUri}/?code=again&state=s3`)).rejects.toThrow();
  });

  it('can be cancelled', async () => {
    const loopback = await listenForRedirect('s4', 5_000);
    loopback.cancel();
    await expect(loopback.redirect).rejects.toMatchObject({ reason: 'cancelled' });
    await expect(loopback.redirect).rejects.toBeInstanceOf(SignInAborted);
    await expect(get(`${loopback.redirectUri}/?code=late&state=s4`)).rejects.toThrow();
  });

  it('gives up after the timeout', async () => {
    const loopback = await listenForRedirect('s5', 30);
    await expect(loopback.redirect).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('only listens on this computer', async () => {
    const loopback = await listenForRedirect('s6', 5_000);
    const port = new URL(loopback.redirectUri).port;
    await expect(get(`http://127.0.0.1:${port}/?code=a&state=s6`)).resolves.toBeDefined();
    await loopback.redirect;
  });
});

describe('classifyRedirectError', () => {
  const error = (description: string, subcode = '') => ({
    error: 'access_denied',
    description,
    subcode,
  });

  it('recognizes an organization that requires an administrator', () => {
    expect(classifyRedirectError(error('AADSTS90094: Admin consent is required.'))).toBe('blocked');
    expect(classifyRedirectError(error('AADSTS900941: An administrator must approve.'))).toBe(
      'blocked',
    );
  });

  it('recognizes a user who declined', () => {
    expect(classifyRedirectError(error('AADSTS65004: User declined to consent.'))).toBe(
      'cancelled',
    );
    expect(classifyRedirectError(error('', 'cancel'))).toBe('cancelled');
  });

  it('treats everything else as a failure', () => {
    expect(classifyRedirectError(error('AADSTS50011: The redirect URI does not match.'))).toBe(
      'failed',
    );
    expect(classifyRedirectError(error('AADSTS900945: something else'))).toBe('failed');
  });
});
