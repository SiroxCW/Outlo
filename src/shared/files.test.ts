import { describe, expect, it } from 'vitest';
import { isRunnableFile, safeFileName } from './files';

describe('safeFileName', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['Übersicht 2026 (final).xlsx', 'Übersicht 2026 (final).xlsx'],
    ['../../.bashrc', '_.._.bashrc'],
    ['/etc/passwd', '_etc_passwd'],
    ['C:\\Windows\\evil.dll', 'C__Windows_evil.dll'],
    ['.hidden', 'hidden'],
    ['...', 'attachment'],
    ['', 'attachment'],
    ['  spaced.txt  ', 'spaced.txt'],
    ['line\nbreak\u0000.txt', 'linebreak.txt'],
    ['invoice\u202Egpj.exe', 'invoicegpj.exe'],
    ['a<b>c|d?.txt', 'a_b_c_d_.txt'],
  ])('%j becomes %j', (name, expected) => expect(safeFileName(name)).toBe(expected));

  it('never contains a path separator and never starts with a dot', () => {
    for (const name of ['a/b', '..\\..\\x', './.x', '.../y', '\u200B.z']) {
      expect(safeFileName(name)).not.toMatch(/[/\\]|^\./);
    }
  });

  it('shortens long names and keeps the ending', () => {
    const name = safeFileName(`${'x'.repeat(500)}.docx`);
    expect(name).toHaveLength(200);
    expect(name.endsWith('.docx')).toBe(true);
  });
});

describe('isRunnableFile', () => {
  it.each([
    'setup.exe',
    'run.sh',
    'app.AppImage',
    'Outlo.desktop',
    'tool.jar',
    'x.PY',
    'a.pdf.exe',
    'script.js ',
    'trick.sh.',
    'README',
    'invoice\u202Efdp.exe',
  ])('refuses to open %j', (name) => expect(isRunnableFile(name)).toBe(true));

  it.each([
    'report.pdf',
    'photo.JPG',
    'notes.txt',
    'table.xlsx',
    'archive.zip',
    'mail.eml',
    'slides.pptx',
  ])('opens %j', (name) => expect(isRunnableFile(name)).toBe(false));
});
