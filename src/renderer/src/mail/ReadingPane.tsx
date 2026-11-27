import { Avatar, Button, makeStyles, Spinner, tokens } from '@fluentui/react-components';
import {
  ArrowForwardRegular,
  ArrowReplyAllRegular,
  ArrowReplyRegular,
  AttachRegular,
  MailRegular,
} from '@fluentui/react-icons';
import type { Message } from '@shared/api';
import { t } from '../i18n';
import { formatAddresses, formatFullDate, formatSize } from './format';
import { MessageBody } from './MessageBody';

const useStyles = makeStyles({
  root: { height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 },
  card: {
    flexGrow: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  empty: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalM,
    color: tokens.colorNeutralForeground3,
  },
  emptyIcon: { fontSize: '64px', color: tokens.colorNeutralForeground4 },
  subject: {
    flexShrink: 0,
    margin: 0,
    padding: '6px 16px 12px',
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  header: {
    flexShrink: 0,
    display: 'flex',
    gap: '12px',
    padding: '16px 24px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  people: { flexGrow: 1, minWidth: 0, lineHeight: '20px' },
  sender: { fontWeight: tokens.fontWeightSemibold },
  line: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  side: { flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  attachments: {
    flexShrink: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '12px 24px 0',
  },
  attachment: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
  },
});

interface ReadingPaneProps {
  // Undefined while loading, null when nothing is selected or the message is gone.
  message: Message | null | undefined;
  dark: boolean;
}

export function ReadingPane({ message, dark }: ReadingPaneProps) {
  const styles = useStyles();
  if (message === undefined) {
    return (
      <div className={styles.empty}>
        <Spinner label={t('reading.loading')} />
      </div>
    );
  }
  if (message === null) {
    return (
      <div className={styles.empty}>
        <MailRegular className={styles.emptyIcon} />
        {t('reading.empty')}
      </div>
    );
  }

  const senderName = message.from.name || message.from.address;
  return (
    <article className={styles.root}>
      <h1 className={styles.subject}>{message.subject || t('reading.noSubject')}</h1>
      <div className={styles.card}>
        <div className={styles.header}>
          <Avatar name={senderName} color="colorful" size={40} />
          <div className={styles.people}>
            <div className={styles.line}>
              <span className={styles.sender}>{senderName}</span> &lt;{message.from.address}&gt;
            </div>
            <div className={styles.line}>
              {t('reading.to')} {formatAddresses(message.to)}
            </div>
            {message.cc.length > 0 && (
              <div className={styles.line}>
                {t('reading.cc')} {formatAddresses(message.cc)}
              </div>
            )}
          </div>
          <div className={styles.side}>
            <div>
              <Button
                appearance="subtle"
                icon={<ArrowReplyRegular />}
                aria-label={t('ribbon.reply')}
                disabled
              />
              <Button
                appearance="subtle"
                icon={<ArrowReplyAllRegular />}
                aria-label={t('ribbon.replyAll')}
                disabled
              />
              <Button
                appearance="subtle"
                icon={<ArrowForwardRegular />}
                aria-label={t('ribbon.forward')}
                disabled
              />
            </div>
            <span className={styles.muted}>{formatFullDate(message.receivedAt)}</span>
          </div>
        </div>

        {message.attachments.length > 0 && (
          <div className={styles.attachments}>
            {message.attachments.map((attachment) => (
              <div key={attachment.id} className={styles.attachment}>
                <AttachRegular />
                {attachment.name}
                <span className={styles.muted}>{formatSize(attachment.size)}</span>
              </div>
            ))}
          </div>
        )}

        {message.body && <MessageBody body={message.body} dark={dark} />}
      </div>
    </article>
  );
}
