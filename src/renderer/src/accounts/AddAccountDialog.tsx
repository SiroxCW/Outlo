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
  Radio,
  RadioGroup,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import { useRef, useState } from 'react';
import type { Account, AddAccountResult, WebAccountKind } from '@shared/api';
import { guessWebAccountKind } from '@shared/accounts';
import { t } from '../i18n';

const useStyles = makeStyles({
  content: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  address: { width: '100%' },
  message: { overflowWrap: 'anywhere' },
  problem: { color: tokens.colorPaletteRedForeground1 },
  mode: { display: 'block', fontWeight: tokens.fontWeightSemibold },
  modeText: { display: 'block', color: tokens.colorNeutralForeground3 },
});

type Mode = 'full' | 'web';
type Step =
  | { kind: 'choose'; problem?: string }
  | { kind: 'waiting' }
  | Exclude<AddAccountResult, { status: 'added' }>;

interface AddAccountDialogProps {
  secureStorage: boolean;
  // A web account that the full sign-in replaces once it works.
  replaces?: Account;
  onAdded(accountId: number): void;
  onClose(): void;
}

export function AddAccountDialog(props: AddAccountDialogProps) {
  const { secureStorage, replaces, onAdded, onClose } = props;
  const styles = useStyles();
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [mode, setMode] = useState<Mode>('full');
  const [email, setEmail] = useState('');
  // Undefined until the user chooses. Until then the address decides.
  const [chosenKind, setChosenKind] = useState<WebAccountKind>();
  const [copied, setCopied] = useState(false);
  const address = useRef<HTMLInputElement>(null);
  const accountKind = chosenKind ?? guessWebAccountKind(email);

  const signIn = async () => {
    setStep({ kind: 'waiting' });
    const result = await window.outlo.accounts.addMicrosoft();
    if (result.status === 'added') {
      // The full sign-in works now: the web mode of this account is no longer needed.
      if (replaces) await window.outlo.accounts.remove(replaces.id);
      onAdded(result.accountId);
    } else if (result.status === 'cancelled') setStep({ kind: 'choose' });
    else setStep(result);
  };

  const addWeb = async () => {
    const result = await window.outlo.accounts.addWeb(email, accountKind);
    if (result.status === 'added') onAdded(result.accountId);
    else if (result.status === 'failed') setStep({ kind: 'choose', problem: result.message });
  };

  // An account that was just blocked belongs to an organization.
  const offerWeb = () => {
    setMode('web');
    setChosenKind('work');
    setStep({ kind: 'choose' });
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

  const choosing = 'kind' in step && step.kind === 'choose';
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
  const option = (name: string, text: string) => (
    <>
      <span className={styles.mode}>{name}</span>
      <span className={styles.modeText}>{text}</span>
    </>
  );

  return (
    <Dialog open modalType="modal" onOpenChange={(_event, data) => !data.open && close()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent className={styles.content}>
            {/* Every kind of Microsoft account can be used either way. The user decides. */}
            {choosing && !replaces && (
              <RadioGroup value={mode} onChange={(_event, data) => setMode(data.value as Mode)}>
                <Radio value="full" label={option(t('add.modeFull'), t('add.modeFullText'))} />
                <Radio value="web" label={option(t('add.modeWeb'), t('add.modeWebText'))} />
              </RadioGroup>
            )}
            {choosing && mode === 'full' && (
              <>
                <span className={styles.muted}>{t('add.fullHint')}</span>
                {!secureStorage && (
                  <MessageBar intent="warning">
                    <MessageBarBody>{t('add.noKeyring')}</MessageBarBody>
                  </MessageBar>
                )}
              </>
            )}
            {choosing && mode === 'web' && (
              <>
                <Input
                  className={styles.address}
                  type="email"
                  placeholder={t('add.webEmail')}
                  aria-label={t('add.webEmail')}
                  value={email}
                  onChange={(_event, data) => setEmail(data.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void addWeb()}
                />
                <RadioGroup
                  layout="horizontal"
                  value={accountKind}
                  onChange={(_event, data) => setChosenKind(data.value as WebAccountKind)}
                >
                  <Radio value="work" label={t('add.kindWork')} />
                  <Radio value="personal" label={t('add.kindPersonal')} />
                </RadioGroup>
                <span className={styles.muted}>{t('add.webHint')}</span>
                <span className={styles.muted}>{t('add.webLimits')}</span>
                {step.problem && <span className={styles.problem}>{step.problem}</span>}
              </>
            )}
            {choosing && <span className={styles.muted}>{t('add.others')}</span>}
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
                {!replaces && <span>{t('add.webOffer')}</span>}
              </>
            )}
            {failed && <span className={styles.message}>{step.message}</span>}
          </DialogContent>
          <DialogActions>
            {choosing && mode === 'full' && (
              <Button appearance="primary" onClick={() => void signIn()}>
                {t('add.microsoft')}
              </Button>
            )}
            {choosing && mode === 'web' && (
              <Button
                appearance="primary"
                disabled={email.trim() === ''}
                onClick={() => void addWeb()}
              >
                {t('add.webAdd')}
              </Button>
            )}
            {blocked && !replaces && (
              <Button appearance="primary" onClick={offerWeb}>
                {t('add.useWeb')}
              </Button>
            )}
            {blocked && (
              <Button appearance={replaces ? 'primary' : 'secondary'} onClick={copy}>
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
