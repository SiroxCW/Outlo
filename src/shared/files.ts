const MAX_NAME_LENGTH = 200;

// File types that run a program or a script when they are opened. A mail may carry any of them,
// so they are never opened straight from the app. Saving them stays possible.
const RUNNABLE = new Set(
  (
    'appimage apk bash bat bin cmd com command cpl csh deb desktop dll dmg elf exe flatpakref ' +
    'fish gadget hta inf iso jar js jse ksh lnk msc msi msp mst out pif pl pkg ps1 py pyc pyw ' +
    'rb reg rpm run scr sct sh shb so url vb vbe vbs ws wsc wsf wsh zsh'
  ).split(' '),
);

// Makes the name of an attachment safe to use as a file name: no folders, nothing hidden.
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    // Control characters, and the ones that reverse the reading direction to disguise the ending.
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .trim();
  if (cleaned === '') return 'attachment';
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;

  // Keep the ending, so the file still opens with the right program.
  const ending = /\.[^.]{1,10}$/.exec(cleaned)?.[0] ?? '';
  return cleaned.slice(0, MAX_NAME_LENGTH - ending.length) + ending;
}

export function isRunnableFile(name: string): boolean {
  const cleaned = safeFileName(name)
    .toLowerCase()
    .replace(/[. ]+$/, '');
  // Without an ending the system decides by the content, which may be a program.
  if (!cleaned.includes('.')) return true;
  return RUNNABLE.has(cleaned.slice(cleaned.lastIndexOf('.') + 1));
}
