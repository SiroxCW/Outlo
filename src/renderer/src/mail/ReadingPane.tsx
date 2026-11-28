import { Spinner } from '@fluentui/react-components';
import { MailRegular } from '@fluentui/react-icons';
import type { ResponseKind } from '@shared/api';
import type { OpenMessage } from '../core/useMessage';
import { t } from '../i18n';
import { Compose } from './Compose';
import { MessageCard } from './MessageCard';
import { useReadingStyles } from './readingStyles';

// What the reading pane shows while there is no message to show.
export function ReadingPlaceholder({ loading }: { loading: boolean }) {
  const styles = useReadingStyles();
  return (
    <div className={styles.empty}>
      {loading ? (
        <Spinner label={t('reading.loading')} />
      ) : (
        <>
          <MailRegular className={styles.emptyIcon} />
          {t('reading.empty')}
        </>
      )}
    </div>
  );
}

// What the reading pane does with messages: answering them, and closing a thrown away draft.
export interface ReadingActions {
  // Set when the user has more than one account, so a draft shows who writes it.
  showFrom: boolean;
  onRespond(kind: ResponseKind, messageId: number): void;
  onDiscarded(sourceId: number | null): void;
}

interface ReadingPaneProps extends ReadingActions {
  // The message is undefined while loading, null when nothing is selected or it is gone.
  open: OpenMessage;
  dark: boolean;
}

// One message, when the list shows messages one by one. A draft written here opens in the editor.
export function ReadingPane({ open, dark, showFrom, onRespond, onDiscarded }: ReadingPaneProps) {
  const styles = useReadingStyles();
  const { message } = open;
  if (!message) return <ReadingPlaceholder loading={message === undefined} />;
  return (
    <article className={styles.root}>
      <h1 className={styles.subject}>{message.subject || t('reading.noSubject')}</h1>
      {message.isDraft ? (
        <Compose
          id={message.id}
          size="fill"
          dark={dark}
          showFrom={showFrom}
          onDiscarded={onDiscarded}
        />
      ) : (
        <MessageCard
          key={message.id}
          open={open}
          message={message}
          dark={dark}
          size="fill"
          onRespond={(kind) => onRespond(kind, message.id)}
        />
      )}
    </article>
  );
}
