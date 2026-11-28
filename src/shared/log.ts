// The log of the app, for bug reports. A log line must never carry personal data: callers pass
// roles, counts, codes and the IDs of this computer, never names, addresses, subjects, texts or
// the IDs of a provider. Text from outside, like the message of an error, is cleaned on its way
// in, as a second net.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields, error?: unknown): void;
  error(message: string, fields?: LogFields, error?: unknown): void;
}

export interface LogSetup {
  // Which process writes: main or core.
  process: string;
  level: LogLevel;
  // The home folder, which is replaced by ~ because it holds the user name.
  home: string;
  write(line: string, level: LogLevel): void;
  now?: () => number;
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LABEL: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};
// The start of every line this module writes. Lines that follow it with an indent belong to it.
export const LOG_LINE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z (DEBUG|INFO |WARN |ERROR) /;
const MAX_TEXT = 2000;
const MAX_FRAMES = 8;

let setup: LogSetup | undefined;

// Without a setup nothing is written, as in tests.
export function setUpLog(next: LogSetup | undefined): void {
  setup = next;
}

export function createLog(area: string): Logger {
  const write = (level: LogLevel, message: string, fields?: LogFields, error?: unknown) => {
    if (!setup || RANK[level] < RANK[setup.level]) return;
    const time = (setup.now ?? Date.now)();
    const line = formatRecord(
      { time, level, process: setup.process, area, message, fields, error },
      setup.home,
    );
    try {
      setup.write(line, level);
    } catch {
      // A log that cannot be written must not stop the app.
    }
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields, error) => write('warn', message, fields, error),
    error: (message, fields, error) => write('error', message, fields, error),
  };
}

export interface LogRecord {
  time: number;
  level: LogLevel;
  process: string;
  area: string;
  message: string;
  fields?: LogFields;
  error?: unknown;
}

// One line, followed by indented lines for the stack of an error.
export function formatRecord(record: LogRecord, home: string): string {
  const { fields, stack } = describe(record.fields, record.error);
  const parts = [
    new Date(record.time).toISOString(),
    LABEL[record.level],
    `${record.process}/${record.area}:`,
    redact(record.message, home).replace(/\s+/g, ' '),
  ];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || !/^[A-Za-z][A-Za-z0-9]*$/.test(key)) continue;
    parts.push(`${key}=${formatValue(value, home)}`);
  }
  const lines = [parts.join(' ')];
  for (const frame of stack) lines.push(`    ${redact(frame, home)}`);
  return lines.join('\n');
}

function formatValue(value: LogValue, home: string): string {
  if (value === null) return 'none';
  if (typeof value !== 'string') return String(value);
  const text = redact(value, home);
  return text === '' || /[\s="\\]/.test(text) ? JSON.stringify(text) : text;
}

// The name, codes and message of an error as fields, and the top of its stack.
function describe(given: LogFields | undefined, error: unknown) {
  const fields: LogFields = { ...given };
  const stack: string[] = [];
  if (error === undefined) return { fields, stack };
  if (!(error instanceof Error)) {
    fields.error = typeof error === 'string' ? error : typeof error;
    return { fields, stack };
  }
  const extra = error as unknown as Record<string, unknown>;
  fields.error = error.constructor?.name || error.name;
  for (const key of ['status', 'code', 'errorCode', 'subError', 'syscall']) {
    const value = extra[key];
    if ((typeof value === 'string' && value !== '') || typeof value === 'number') {
      fields[key] = value;
    }
  }
  // Microsoft names the reason of a refused sign-in with a code like AADSTS90094.
  const aadsts = /\bAADSTS\d+\b/.exec(error.message)?.[0];
  if (aadsts) fields.aadsts = aadsts;
  // The message of an error from outside may name people or folders in a way no cleaning can
  // find. When the error has a code, the code tells enough and the message stays out.
  if (fields.code === undefined && fields.errorCode === undefined) fields.detail = error.message;
  for (const line of (error.stack ?? '').split('\n')) {
    if (/^\s+at /.test(line) && stack.length < MAX_FRAMES) stack.push(line.trim());
  }
  return { fields, stack };
}

// Hosts whose addresses say nothing about the user. Their paths stay, with IDs taken out.
const SAFE_HOSTS = new Set([
  'graph.microsoft.com',
  'login.microsoftonline.com',
  'login.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'outlook.live.com',
  'localhost',
  '127.0.0.1',
]);

const URL_PATTERN = /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s"'<>()[\]{}]+/gi;
const BEARER = /\bBearer\s+[^\s"',]+/gi;
const JWT = /\beyJ[\w-]{8,}(?:\.[\w-]*){0,2}/g;
const ADDRESS = /[\w.%+-]+(?:@|%40)[\w-]+(?:\.[\w-]+)+/gi;
const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_ID = /[A-Za-z0-9+_=-]{32,}/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi;
const HOME = /\/(?:var\/)?home\/[^/\s'"]+|\/root(?=\/)/g;
// A path, unless it names a file of program code, as in the frames of a stack.
const PATH = /(^|[\s(=,])((?:~\/|\/)[^\s'"()<>]*)/g;
const CODE_FILE = /\.(?:[cm]?js|tsx?|node)(?::\d+){0,2}$|^\/?$/;
// Quoted text, as servers put names of folders and files in their messages. The quote has to
// stand at the edge of a word, so "couldn't" stays as it is.
const QUOTED =
  /(^|[\s([{:=,])(?:'[^'\n]{1,300}'|"[^"\n]{1,300}"|\u2018[^\u2019\n]{1,300}\u2019|\u201c[^\u201d\n]{1,300}\u201d)(?=$|[\s)\]},.:;!?])/g;

// Takes personal data out of text from outside: addresses, links, tokens, IDs of providers,
// network addresses, paths and quoted names. Names and subjects in plain text cannot be found,
// which is why callers must never pass them.
export function redact(input: string, home = ''): string {
  let text = input.length > MAX_TEXT ? `${input.slice(0, MAX_TEXT)} [cut]` : input;
  // Usual homes first, then the given one, which may lie elsewhere.
  text = text.replace(HOME, '~');
  if (home.length > 1) text = text.replaceAll(home, '~');
  return text
    .replace(BEARER, 'Bearer <token>')
    .replace(JWT, '<token>')
    .replace(URL_PATTERN, redactUrl)
    .replace(ADDRESS, '<address>')
    .replace(GUID, '<guid>')
    .replace(LONG_ID, '<id>')
    .replace(IPV4, (found) => (found.startsWith('127.') ? found : '<ip>'))
    .replace(IPV6, '<ip>')
    .replace(PATH, (_found, before: string, path: string) =>
      CODE_FILE.test(path) ? before + path : `${before}<path>`,
    )
    .replace(QUOTED, '$1<text>');
}

// An address of a known service keeps its host and path, without query and without IDs.
export function redactUrl(address: string): string {
  // Frames of a stack may name their file as a file:// address.
  if (/^file:/i.test(address)) return CODE_FILE.test(address) ? address : '<path>';
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return '<link>';
  }
  const known =
    url.protocol === 'app:' ||
    ((url.protocol === 'https:' || url.protocol === 'http:') && SAFE_HOSTS.has(url.hostname));
  if (!known) return '<link>';
  const path = url.pathname
    .split('/')
    .map((segment) =>
      /@|%40/i.test(segment) || /[A-Za-z0-9_=%-]{20,}/.test(segment) || segment.length > 60
        ? '{id}'
        : segment,
    )
    .join('/');
  return `${url.protocol}//${url.host}${path}`;
}
