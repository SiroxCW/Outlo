import { afterEach, describe, expect, it } from 'vitest';
import { createLog, formatRecord, LOG_LINE, redact, redactUrl, setUpLog } from './log';

const HOME = '/home/tester';

afterEach(() => setUpLog(undefined));

describe('redact', () => {
  it.each([
    ['Mailbox anna.berg@bluepeak.example is full', 'Mailbox <address> is full'],
    ['user=anna.berg%40bluepeak.example', 'user=<address>'],
    ['Authorization: Bearer abc.def-ghi', 'Authorization: Bearer <token>'],
    ['token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln here', 'token <token> here'],
    ['Trace ID: 0a1b2c3d-4e5f-6789-abcd-ef0123456789', 'Trace ID: <guid>'],
    ['id AAMkAGI2TG93AAAuAAAAAAAiQ8W967B7TKBjgx9rVEURAQ= gone', 'id <id> gone'],
    ['connect ECONNREFUSED 20.190.151.7:443', 'connect ECONNREFUSED <ip>:443'],
    ['listening on 127.0.0.1:41234', 'listening on 127.0.0.1:41234'],
    ['from 2001:db8:85a3:0:0:8a2e:370:7334 on', 'from <ip> on'],
    ["open '/home/tester/Downloads/Contract Smith.pdf'", 'open <text>'],
    ['Access to "Tax papers" is denied', 'Access to <text> is denied'],
    ['The folder “Tax papers” is gone', 'The folder <text> is gone'],
    ["It couldn't find the user's folder", "It couldn't find the user's folder"],
    ['Failed to open /home/tester/.config/outlo/opened/a1/Letter.pdf', 'Failed to open <path>'],
    ['at load (/home/tester/app/out/core/index.js:12:5)', 'at load (~/app/out/core/index.js:12:5)'],
    ['at load (/home/other/app/out/core/index.js:12:5)', 'at load (~/app/out/core/index.js:12:5)'],
    ['at load (file:///opt/outlo/index.mjs:1:2)', 'at load (file:///opt/outlo/index.mjs:1:2)'],
    ['saved to /var/home/tester/x.pdf', 'saved to <path>'],
    ['see https://tracker.example/open?id=anna', 'see <link>'],
    ['a / b', 'a / b'],
  ])('cleans %s', (input, output) => {
    expect(redact(input, HOME)).toBe(output);
  });

  it('keeps the path of known services without IDs and query', () => {
    expect(
      redact(
        'GET https://graph.microsoft.com/v1.0/me/mailFolders/AAMkAGI2TG93AAAuAAAAAAAiQ8W967B7/messages/delta?$deltatoken=abc',
      ),
    ).toBe('GET https://graph.microsoft.com/v1.0/me/mailFolders/{id}/messages/delta');
    expect(redactUrl('https://graph.microsoft.com/v1.0/users/anna@x.example/messages')).toBe(
      'https://graph.microsoft.com/v1.0/users/{id}/messages',
    );
    expect(redactUrl('app://outlo/assets/index.js?x=1')).toBe('app://outlo/assets/index.js');
    expect(redactUrl('not an address')).toBe('<link>');
  });

  it('gives the same result when cleaned twice', () => {
    const text =
      "Mail of anna@x.example in 'Taxes' at https://graph.microsoft.com/v1.0/me/messages/AAMkAGI2TG93AAAuAAAAAAAiQ8W967B7 from 20.1.2.3";
    expect(redact(redact(text, HOME), HOME)).toBe(redact(text, HOME));
  });

  it('cuts long text and stays fast on hostile input', () => {
    expect(redact('x'.repeat(5000)).length).toBeLessThan(2100);
    const hostile = [
      'a'.repeat(1900),
      "'".repeat(500),
      '@'.repeat(500),
      '/'.repeat(500),
      'a.'.repeat(1000),
    ].join('');
    const started = performance.now();
    for (let round = 0; round < 20; round++) redact(hostile, HOME);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('formatRecord', () => {
  const time = Date.UTC(2026, 10, 28, 9, 30, 0, 123);

  it('writes time, level, place, message and fields on one line', () => {
    const line = formatRecord(
      {
        time,
        level: 'info',
        process: 'core',
        area: 'sync',
        message: 'Read a page\nof a folder',
        fields: {
          account: 1,
          role: 'inbox',
          more: false,
          none: null,
          gone: undefined,
          'bad key': 1,
        },
      },
      HOME,
    );
    expect(line).toBe(
      '2026-11-28T09:30:00.123Z INFO  core/sync: Read a page of a folder account=1 role=inbox more=false none=none',
    );
    expect(LOG_LINE.test(line)).toBe(true);
  });

  it('quotes values with spaces, cleaned first', () => {
    const line = formatRecord(
      {
        time,
        level: 'warn',
        process: 'main',
        area: 'app',
        message: 'x',
        fields: { system: 'Fedora Linux 43', detail: 'for anna@x.example', empty: '' },
      },
      HOME,
    );
    expect(line).toContain('system="Fedora Linux 43" detail="for <address>" empty=""');
  });

  it('describes an error by its codes, without its message, and the top of its stack', () => {
    class GraphError extends Error {
      readonly status = 403;
      readonly code = 'ErrorAccessDenied';
    }
    const error = new GraphError("Access to 'Taxes' of anna@x.example is denied");
    error.stack = [
      `GraphError: ${error.message}`,
      '    at send (/home/tester/outlo/out/core/index.js:10:5)',
      ...Array.from({ length: 12 }, (_, index) => `    at frame${index} (node:internal:1:1)`),
    ].join('\n');
    const lines = formatRecord(
      { time, level: 'error', process: 'core', area: 'sync', message: 'Failed', error },
      HOME,
    ).split('\n');
    expect(lines[0]).toBe(
      '2026-11-28T09:30:00.123Z ERROR core/sync: Failed error=GraphError status=403 code=ErrorAccessDenied',
    );
    expect(lines[1]).toBe('    at send (~/outlo/out/core/index.js:10:5)');
    expect(lines).toHaveLength(9);
  });

  it('keeps the cleaned message of an error without a code, and finds sign-in codes', () => {
    const own = formatRecord(
      {
        time,
        level: 'warn',
        process: 'main',
        area: 'app',
        message: 'x',
        error: new Error('The attachment of anna@x.example does not exist any more'),
      },
      HOME,
    );
    expect(own.split('\n')[0]).toMatch(
      / error=Error detail="The attachment of <address> does not exist any more"$/,
    );

    const refused = Object.assign(
      new Error("invalid_grant: AADSTS50020: User account 'anna@x.example' is not allowed"),
      { errorCode: 'invalid_grant' },
    );
    const line = formatRecord(
      { time, level: 'warn', process: 'main', area: 'app', message: 'x', error: refused },
      HOME,
    ).split('\n')[0];
    expect(line).toMatch(/ error=Error errorCode=invalid_grant aadsts=AADSTS50020$/);
  });

  it('names something thrown that is not an error', () => {
    const line = formatRecord(
      { time, level: 'error', process: 'main', area: 'app', message: 'x', error: 42 },
      HOME,
    );
    expect(line).toMatch(/ error=number$/);
  });
});

describe('createLog', () => {
  it('writes nothing without a setup', () => {
    expect(() => createLog('test').error('Nothing happens')).not.toThrow();
  });

  it('writes from the chosen level on, and survives a failing writer', () => {
    const lines: string[] = [];
    setUpLog({ process: 'main', level: 'info', home: HOME, write: (line) => lines.push(line) });
    const log = createLog('test');
    log.debug('Too detailed');
    log.info('Kept', { count: 2 });
    log.warn('Also kept', {}, new Error('at /home/tester/x.txt'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/INFO {2}main\/test: Kept count=2$/);
    expect(lines[1]).toContain('detail="at <path>"');

    setUpLog({
      process: 'main',
      level: 'debug',
      home: HOME,
      write: () => {
        throw new Error('Disk full');
      },
    });
    expect(() => log.error('Still fine')).not.toThrow();
  });
});
