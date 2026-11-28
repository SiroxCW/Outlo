import { Spinner } from '@fluentui/react-components';
import { MailRegular } from '@fluentui/react-icons';
import type { OpenMessage } from '../core/useMessage';
import { t } from '../i18n';
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

interface ReadingPaneProps {
  // The message is undefined while loading, null when nothing is selected or it is gone.
  open: OpenMessage;
  dark: boolean;
}

// One message, when the list shows messages one by one.
export function ReadingPane({ open, dark }: ReadingPaneProps) {
  const styles = useReadingStyles();
  const { message } = open;
  if (!message) return <ReadingPlaceholder loading={message === undefined} />;
  return (
    <article className={styles.root}>
      <h1 className={styles.subject}>{message.subject || t('reading.noSubject')}</h1>
      <MessageCard key={message.id} open={open} message={message} dark={dark} size="fill" />
    </article>
  );
}
