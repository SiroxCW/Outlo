import { ipcMain } from 'electron';
import {
  ACCOUNTS_ADD_MICROSOFT,
  ACCOUNTS_CANCEL_ADD,
  ACCOUNTS_REMOVE,
  SESSION_GET_INFO,
  SESSION_SET_DEMO,
  type AddAccountResult,
  type SessionInfo,
} from '@shared/api';
import { isDemoSession, requestCore, setDemoSession } from './core-process';
import {
  addMicrosoftAccount,
  cancelMicrosoftSignIn,
  forgetMicrosoftAccount,
  hasSecureStorage,
} from './microsoft/sign-in';
import { isTrustedSender } from './renderer-site';
import { writeDemoSession } from './window-settings';

export function handleAccountRequests(): void {
  ipcMain.handle(ACCOUNTS_ADD_MICROSOFT, (event): Promise<AddAccountResult> | AddAccountResult => {
    if (!isTrustedSender(event)) return { status: 'failed', message: 'Not allowed' };
    // The demo works on invented data only. Real accounts belong into the real session.
    if (isDemoSession()) return { status: 'failed', message: 'Leave the demo first' };
    return addMicrosoftAccount();
  });

  ipcMain.on(ACCOUNTS_CANCEL_ADD, (event) => {
    if (isTrustedSender(event)) cancelMicrosoftSignIn();
  });

  ipcMain.handle(ACCOUNTS_REMOVE, async (event, accountId: unknown) => {
    if (!isTrustedSender(event) || typeof accountId !== 'number' || isDemoSession()) return;
    const { remoteId } = await requestCore('accounts.remove', { id: accountId });
    if (remoteId) await forgetMicrosoftAccount(remoteId);
  });

  ipcMain.handle(SESSION_GET_INFO, async (): Promise<SessionInfo> => ({
    demo: isDemoSession(),
    secureStorage: await hasSecureStorage(),
  }));

  ipcMain.handle(SESSION_SET_DEMO, async (event, demo: unknown) => {
    if (!isTrustedSender(event) || typeof demo !== 'boolean') return;
    writeDemoSession(demo);
    await setDemoSession(demo);
  });
}
