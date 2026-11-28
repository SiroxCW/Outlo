import { readFileSync } from 'node:fs';
import { arch, homedir, release } from 'node:os';
import { join } from 'node:path';
import { app, ipcMain, shell, type UtilityProcess, type WebContents } from 'electron';
import { LOGS_OPEN_FOLDER } from '@shared/api';
import {
  createLog,
  formatRecord,
  LOG_LINE,
  setUpLog,
  type LogFields,
  type LogLevel,
} from '@shared/log';
import { LineSplitter, LogFile } from './log-file';
import { isTrustedSender } from './renderer-site';

const log = createLog('app');
const home = homedir();
let file: LogFile | undefined;

export const logDirectory = (): string => join(app.getPath('userData'), 'logs');

// More detail, like every request to Microsoft Graph, when started with OUTLO_LOG_LEVEL=debug.
export const logLevel = (): LogLevel =>
  process.env.OUTLO_LOG_LEVEL === 'debug' ? 'debug' : 'info';

function write(line: string, level: LogLevel): void {
  file?.write(line);
  // Problems also go to the terminal, or to the system journal when started from the desktop.
  if (level === 'warn' || level === 'error') process.stderr.write(`${line}\n`);
}

// Starts the log of the main process. Call once the user data folder is known.
export function startLogging(): void {
  file = new LogFile(join(logDirectory(), 'outlo.log'));
  // A terminal that went away must not take the app with it.
  process.stderr.on('error', () => undefined);
  setUpLog({ process: 'main', level: logLevel(), home, write });
  process.on('uncaughtExceptionMonitor', (error, origin) =>
    log.error('Uncaught exception', { origin }, error),
  );
  process.on('unhandledRejection', (reason) => log.error('Unhandled rejection', {}, reason));
  log.info('Started', {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    system: systemName(),
    kernel: release(),
    arch: arch(),
    desktop: process.env.XDG_CURRENT_DESKTOP,
    session: process.env.XDG_SESSION_TYPE,
    packaged: app.isPackaged,
    flatpak: process.env.FLATPAK_ID !== undefined,
  });
  app.on('will-quit', () => log.info('Quit'));

  ipcMain.on(LOGS_OPEN_FOLDER, (event) => {
    if (!isTrustedSender(event)) return;
    log.info('Opening the log folder');
    void shell.openPath(logDirectory()).then((problem) => {
      if (problem) log.warn('The log folder could not be opened', { detail: problem });
    });
  });
}

function entry(level: LogLevel, message: string) {
  return { time: Date.now(), level, process: 'main', area: 'app', message };
}

// The name of the Linux distribution, like "Fedora Linux 43 (Workstation Edition)".
function systemName(): string {
  try {
    const text = readFileSync('/etc/os-release', 'utf8');
    return /^PRETTY_NAME="?([^"\n]*)"?$/m.exec(text)?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// The core writes its log lines to its output. Anything else there, like the report of a
// crash, is cleaned and written as well.
export function logCoreOutput(core: UtilityProcess): void {
  let lastLevel: LogLevel = 'info';
  const fromCore = (line: string, isError: boolean) => {
    const level = LOG_LINE.exec(line)?.[1]?.trim().toLowerCase() as LogLevel | undefined;
    if (!isError && level) {
      lastLevel = level;
      write(line, level);
    } else if (!isError && line.startsWith('    ')) {
      write(line, lastLevel);
    } else if (line.trim() !== '') {
      const record = { ...entry('warn', line), process: 'core', area: 'output' };
      write(formatRecord(record, home), 'warn');
    }
  };
  for (const [stream, isError] of [
    [core.stdout, false],
    [core.stderr, true],
  ] as const) {
    if (!stream) continue;
    const lines = new LineSplitter((line) => fromCore(line, isError));
    stream.on('data', lines.push);
    stream.on('end', () => lines.end());
  }
}

const pageLog = createLog('page');

// Crashes and failures of the window and of the pages of web accounts. Messages that the
// window writes to its console are kept when they are errors of the app itself, not of a mail.
export function watchContents(contents: WebContents, page: 'window' | 'web'): void {
  const fields: LogFields = { page };
  contents.on('render-process-gone', (_event, details) =>
    pageLog.error('The page process ended', {
      ...fields,
      reason: details.reason,
      exitCode: details.exitCode,
    }),
  );
  contents.on('unresponsive', () => pageLog.warn('The page stopped responding', fields));
  contents.on('responsive', () => pageLog.info('The page responds again', fields));
  contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    // -3 is a load that was replaced by another one, which is normal.
    if (isMainFrame && code !== -3) {
      pageLog.warn('The page failed to load', { ...fields, code, reason: description });
    }
  });
  if (page !== 'window') return;
  contents.on('preload-error', (_event, _path, error) =>
    pageLog.error('The preload script failed', fields, error),
  );
  contents.on('console-message', (details) => {
    if (details.level !== 'error' || details.frame !== contents.mainFrame) return;
    // Chromium reports this when a layout settles over several frames. It is harmless.
    if (details.message.startsWith('ResizeObserver loop')) return;
    pageLog.error('Error in the window', {
      ...fields,
      source: details.sourceId,
      line: details.lineNumber,
      detail: details.message,
    });
  });
}
