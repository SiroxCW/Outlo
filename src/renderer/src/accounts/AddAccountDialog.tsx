import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import { useRef, useState } from 'react';
import type { AddAccountResult } from '@shared/api';
import { t } from '../i18n';

const useStyles = makeStyles({
  content: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  address: { width: '100%' },
  message: { overflowWrap: 'anywhere' },
});

type Step =
  { kind: 'choose' } | { kind: 'waiting' } | Exclude<AddAccountResult, { status: 'added' }>;

interface AddAccountDialogProps {
  secureStorage: boolean;
  onAdded(accountId: number): void;
  onClose(): void;
}

export function AddAccountDialog({ secureStorage, onAdded, onClose }: AddAccountDialogProps) {
  const styles = useStyles();
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [copied, setCopied] = useState(false);
  const address = useRef<HTMLInputElement>(null);

  const signIn = async () => {
    setStep({ kind: 'waiting' });
    const result = await window.outlo.accounts.addMicrosoft();
    if (result.status === 'added') onAdded(result.accountId);
    else if (result.status === 'cancelled') setStep({ kind: 'choose' });
    else setStep(result);
  };

  const close = () => {
    if ('kind' in step && step.kind === 'waiting') window.outlo.accounts.cancelAdd();
    onClose();
  };

  // The app grants itself no clipboard permission, so the address is copied the classic way.
  const copy = () => {
    address.current?.select();
    setCopied(document.execCommand('copy'));
  };

  const waiting = 'kind' in step && step.kind === 'waiting';
  const blocked = 'status' in step && step.status === 'blocked';
  const failed = 'status' in step && step.status === 'failed';
  const title = waiting
    ? t('add.waitingTitle')
    : blocked
      ? t('add.blockedTitle')
      : failed
        ? t('add.failedTitle')
        : t('add.title');

  return (
    <Dialog open modalType="modal" onOpenChange={(_event, data) => !data.open && close()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent className={styles.content}>
            {'kind' in step && step.kind === 'choose' && (
              <>
                <span>{t('add.text')}</span>
                {!secureStorage && (
                  <MessageBar intent="warning">
                    <MessageBarBody>{t('add.noKeyring')}</MessageBarBody>
                  </MessageBar>
                )}
                <span className={styles.muted}>{t('add.others')}</span>
              </>
            )}
            {waiting && <Spinner labelPosition="after" label={t('add.waiting')} />}
            {blocked && (
              <>
                <span>{t('add.blocked')}</span>
                <Input
                  ref={address}
                  className={styles.address}
                  readOnly
                  value={step.adminConsentUrl}
                  onFocus={(event) => event.target.select()}
                />
                <span className={styles.muted}>{t('add.blockedHint')}</span>
              </>
            )}
            {failed && <span className={styles.message}>{step.message}</span>}
          </DialogContent>
          <DialogActions>
            {'kind' in step && step.kind === 'choose' && (
              <Button appearance="primary" onClick={() => void signIn()}>
                {t('add.microsoft')}
              </Button>
            )}
            {blocked && (
              <Button appearance="primary" onClick={copy}>
                {copied ? t('add.copied') : t('add.copy')}
              </Button>
            )}
            {failed && (
              <Button appearance="primary" onClick={() => void signIn()}>
                {t('add.retry')}
              </Button>
            )}
            <Button onClick={close}>{waiting ? t('action.cancel') : t('action.close')}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
