import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LineSplitter, LogFile } from './log-file';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'outlo-log-'));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('LogFile', () => {
  it('creates its folder and a file only the user can read', () => {
    const file = new LogFile(join(directory, 'logs', 'outlo.log'));
    file.write('first');
    file.write('second');
    file.close();
    const path = join(directory, 'logs', 'outlo.log');
    expect(readFileSync(path, 'utf8')).toBe('first\nsecond\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, 'logs')).mode & 0o777).toBe(0o700);
  });

  it('keeps the current file and the one before, and no more', () => {
    const path = join(directory, 'outlo.log');
    const file = new LogFile(path, 20);
    for (const line of ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd', 'eeeeeeeeee']) {
      file.write(line);
    }
    file.close();
    expect(readFileSync(path, 'utf8')).toBe('eeeeeeeeee\n');
    expect(readFileSync(`${path}.1`, 'utf8')).toBe('cccccccccc\ndddddddddd\n');
    expect(existsSync(`${path}.2`)).toBe(false);
  });

  it('continues a file from an earlier run, and starts anew when it is full', () => {
    const path = join(directory, 'outlo.log');
    writeFileSync(path, 'old run\n');
    const file = new LogFile(path, 1000);
    file.write('new run');
    file.close();
    expect(readFileSync(path, 'utf8')).toBe('old run\nnew run\n');

    writeFileSync(path, 'x'.repeat(30));
    const full = new LogFile(path, 20);
    full.write('fresh');
    full.close();
    expect(readFileSync(path, 'utf8')).toBe('fresh\n');
    expect(readFileSync(`${path}.1`, 'utf8')).toBe('x'.repeat(30));
  });

  it('does not throw when it cannot write', () => {
    writeFileSync(join(directory, 'blocked'), '');
    const file = new LogFile(join(directory, 'blocked', 'outlo.log'));
    expect(() => file.write('lost')).not.toThrow();
  });
});

describe('LineSplitter', () => {
  it('joins pieces into lines and keeps characters split between pieces whole', () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((line) => lines.push(line));
    const bytes = Buffer.from('erste Zeile\r\nzweite Zeile mit ü\nRest');
    const cut = bytes.indexOf(Buffer.from('ü')) + 1;
    splitter.push(bytes.subarray(0, 5));
    splitter.push(bytes.subarray(5, cut));
    splitter.push(bytes.subarray(cut));
    expect(lines).toEqual(['erste Zeile', 'zweite Zeile mit ü']);
    splitter.end();
    expect(lines).toEqual(['erste Zeile', 'zweite Zeile mit ü', 'Rest']);
  });

  it('cuts a line without end', () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((line) => lines.push(line));
    for (let piece = 0; piece < 20; piece++) splitter.push('x'.repeat(1000));
    expect(lines.length).toBeGreaterThan(0);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(8000);
  });
});
