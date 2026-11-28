import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import type { Account } from '@shared/api';
import { t } from '../i18n';

interface RemoveAccountDialogProps {
  account: Account;
  onRemoved(): void;
  onClose(): void;
}

export function RemoveAccountDialog({ account, onRemoved, onClose }: RemoveAccountDialogProps) {
  const remove = () => {
    void window.outlo.accounts.remove(account.id);
    onRemoved();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(_event, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('remove.title')}</DialogTitle>
          <DialogContent>
            <p>{account.email}</p>
            <p>{t('remove.text')}</p>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={remove}>
              {t('remove.confirm')}
            </Button>
            <Button onClick={onClose}>{t('action.cancel')}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
