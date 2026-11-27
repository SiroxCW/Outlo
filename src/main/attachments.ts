import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { ATTACHMENTS_OPEN, ATTACHMENTS_SAVE, type AttachmentResult } from '@shared/api';
import { isRunnableFile, safeFileName } from '@shared/files';
import { requestCore } from './core-process';
import { isTrustedSender } from './renderer-site';

// Attachments the user opens are written here first. The folder is emptied on every start.
const openedDirectory = () => join(app.getPath('userData'), 'opened');

const failed = (error: unknown): AttachmentResult => ({
  status: 'failed',
  message: error instanceof Error ? error.message : String(error),
});

export function handleAttachmentRequests(): void {
  rmSync(openedDirectory(), { recursive: true, force: true });

  ipcMain.handle(ATTACHMENTS_SAVE, async (event, id: unknown): Promise<AttachmentResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!isTrustedSender(event) || !window || typeof id !== 'number') return failed('Not allowed');
    try {
      const info = await requestCore('attachments.info', { id });
      if (!info) return failed('The attachment does not exist any more');
      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        defaultPath: join(app.getPath('downloads'), safeFileName(info.name)),
      });
      if (canceled || !filePath) return { status: 'cancelled' };
      await requestCore('attachments.download', { id, path: filePath });
      return { status: 'done' };
    } catch (error) {
      return failed(error);
    }
  });

  ipcMain.handle(ATTACHMENTS_OPEN, async (event, id: unknown): Promise<AttachmentResult> => {
    if (!isTrustedSender(event) || typeof id !== 'number') return failed('Not allowed');
    try {
      const info = await requestCore('attachments.info', { id });
      if (!info) return failed('The attachment does not exist any more');
      if (isRunnableFile(info.name)) return { status: 'blocked' };

      // A folder of its own per file, so two attachments with the same name do not collide.
      mkdirSync(openedDirectory(), { recursive: true, mode: 0o700 });
      const path = join(mkdtempSync(join(openedDirectory(), 'a')), safeFileName(info.name));
      await requestCore('attachments.download', { id, path });
      const problem = await shell.openPath(path);
      return problem ? failed(problem) : { status: 'done' };
    } catch (error) {
      return failed(error);
    }
  });
}
