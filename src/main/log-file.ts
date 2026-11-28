import { closeSync, fstatSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// Two files of this size at most: the current one and the one before.
export const MAX_LOG_SIZE = 2 * 1024 * 1024;
const MAX_LINE = 8000;

// A log file that is written right away, so the last lines before a crash are in it. When it
// is full it becomes outlo.log.1 and a new one starts. Only the user can read it.
export class LogFile {
  private fd: number | undefined;
  private size = 0;

  constructor(
    readonly path: string,
    private readonly maxSize = MAX_LOG_SIZE,
  ) {}

  write(line: string): void {
    try {
      if (this.fd === undefined) this.open();
      else if (this.size >= this.maxSize) this.rotate();
      const bytes = Buffer.from(`${line}\n`);
      writeSync(this.fd!, bytes);
      this.size += bytes.length;
    } catch {
      // A log that cannot be written must not stop the app.
    }
  }

  close(): void {
    if (this.fd !== undefined) closeSync(this.fd);
    this.fd = undefined;
  }

  private open(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    this.fd = openSync(this.path, 'a', 0o600);
    this.size = fstatSync(this.fd).size;
    if (this.size >= this.maxSize) this.rotate();
  }

  private rotate(): void {
    this.close();
    renameSync(this.path, `${this.path}.1`);
    this.fd = openSync(this.path, 'a', 0o600);
    this.size = 0;
  }
}

// Cuts the output of another process into lines. Characters split between two pieces stay
// whole, and an endless line is cut, so a broken process cannot fill the memory.
export class LineSplitter {
  private readonly decoder = new StringDecoder('utf8');
  private rest = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push = (chunk: Buffer | string): void => {
    const text = this.rest + (typeof chunk === 'string' ? chunk : this.decoder.write(chunk));
    const lines = text.split('\n');
    this.rest = lines.pop() ?? '';
    if (this.rest.length > MAX_LINE) {
      lines.push(this.rest.slice(0, MAX_LINE));
      this.rest = '';
    }
    for (const line of lines) this.onLine(line.replace(/\r$/, '').slice(0, MAX_LINE));
  };

  end(): void {
    const last = this.rest + this.decoder.end();
    this.rest = '';
    if (last !== '') this.onLine(last.slice(0, MAX_LINE));
  }
}
