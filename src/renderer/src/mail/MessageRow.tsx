import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  AttachRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  FlagFilled,
  ImportantFilled,
} from '@fluentui/react-icons';
import { memo } from 'react';
import type { ListEntry, MessageSummary } from '@shared/api';
import { t } from '../i18n';
import { formatAddresses, formatListTime } from './format';

export const MESSAGE_ROW_HEIGHT = 72;
export const CHILD_ROW_HEIGHT = 52;

const useStyles = makeStyles({
  root: {
    height: `${MESSAGE_ROW_HEIGHT}px`,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '0 12px 0 36px',
    position: 'relative',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    cursor: 'default',
    userSelect: 'none',
    fontSize: tokens.fontSizeBase200,
    lineHeight: '20px',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  child: { height: `${CHILD_ROW_HEIGHT}px`, paddingLeft: '52px' },
  selected: {
    backgroundColor: tokens.colorBrandBackground2,
    boxShadow: `inset 0 0 0 1px ${tokens.colorBrandStroke2}`,
    ':hover': { backgroundColor: tokens.colorBrandBackground2 },
  },
  unreadBar: {
    position: 'absolute',
    left: 0,
    top: '2px',
    bottom: '2px',
    width: '3px',
    borderRadius: '2px',
    backgroundColor: tokens.colorBrandForeground1,
  },
  expand: {
    position: 'absolute',
    left: '8px',
    top: '6px',
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 'none',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground2,
    fontSize: '14px',
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Pressed },
  },
  line: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
  sender: { fontSize: tokens.fontSizeBase300, flexGrow: 1 },
  subject: { flexGrow: 1 },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  unread: { fontWeight: tokens.fontWeightSemibold },
  unreadSubject: { color: tokens.colorBrandForeground1 },
  muted: { color: tokens.colorNeutralForeground3 },
  folder: { flexShrink: 0, color: tokens.colorBrandForeground1 },
  time: { flexShrink: 0 },
  icons: { display: 'flex', gap: '4px', flexShrink: 0, fontSize: '14px' },
  flag: { color: tokens.colorPaletteRedForeground1 },
  important: { color: tokens.colorPaletteRedForeground1 },
  placeholder: {
    height: '10px',
    borderRadius: '5px',
    backgroundColor: tokens.colorNeutralBackground5,
    margin: '5px 0',
  },
});

interface MessageRowProps {
  message: ListEntry | undefined;
  selected: boolean;
  // Sent mail shows who it went to, everything else who it came from.
  showRecipient: boolean;
  now: Date;
  onSelect(message: ListEntry): void;
  // Set for a conversation of more than one message.
  expanded?: boolean;
  onToggle?(message: ListEntry): void;
}

export const MessageRow = memo(function MessageRow(props: MessageRowProps) {
  const styles = useStyles();
  const { message, selected } = props;

  // The row is on screen before its page has arrived from the core.
  if (!message) {
    return (
      <div className={styles.root} aria-hidden>
        <div className={styles.placeholder} style={{ width: '40%' }} />
        <div className={styles.placeholder} style={{ width: '75%' }} />
      </div>
    );
  }

  // A row of a conversation speaks for all its messages, except for subject, text and time.
  const { conversation } = message;
  const unread = conversation ? conversation.unreadCount > 0 : !message.isRead;
  const flagged = conversation?.isFlagged ?? message.isFlagged;
  const files = conversation?.hasAttachments ?? message.hasAttachments;
  const person = props.showRecipient
    ? formatAddresses(message.to)
    : conversation
      ? conversation.senders.map((sender) => sender.name || sender.address).join('; ')
      : message.from.name;
  const expandable = conversation !== undefined && conversation.size > 1 && props.onToggle;
  return (
    <div
      className={mergeClasses(styles.root, selected && styles.selected)}
      role="option"
      aria-selected={selected}
      aria-expanded={expandable ? props.expanded === true : undefined}
      onClick={() => props.onSelect(message)}
    >
      {unread && <div className={styles.unreadBar} />}
      {expandable && (
        <button
          type="button"
          className={styles.expand}
          aria-label={t(props.expanded ? 'list.collapse' : 'list.expand')}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggle?.(message);
          }}
        >
          {props.expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        </button>
      )}
      <div className={styles.line}>
        <span className={mergeClasses(styles.sender, styles.ellipsis, unread && styles.unread)}>
          {person || message.from.address}
        </span>
        <span className={styles.icons}>
          {message.importance === 'high' && <ImportantFilled className={styles.important} />}
          {files && <AttachRegular />}
          {flagged && <FlagFilled className={styles.flag} />}
        </span>
      </div>
      <div className={styles.line}>
        <span
          className={mergeClasses(
            styles.subject,
            styles.ellipsis,
            unread && styles.unread,
            unread && styles.unreadSubject,
          )}
        >
          {message.subject || t('reading.noSubject')}
        </span>
        <span className={mergeClasses(styles.time, unread && styles.unread)}>
          {formatListTime(message.receivedAt, props.now)}
        </span>
      </div>
      <div className={mergeClasses(styles.ellipsis, styles.muted)}>{message.preview}</div>
    </div>
  );
});

interface ChildRowProps {
  message: MessageSummary;
  // Set when the message lies in another folder than the list, like an answer in Sent Items.
  folderName: string | undefined;
  selected: boolean;
  now: Date;
  onSelect(message: MessageSummary): void;
}

// One message of an open conversation, below the row of the conversation.
export const ChildRow = memo(function ChildRow(props: ChildRowProps) {
  const styles = useStyles();
  const { message, selected } = props;
  const unread = !message.isRead;
  return (
    <div
      className={mergeClasses(styles.root, styles.child, selected && styles.selected)}
      role="option"
      aria-selected={selected}
      onClick={() => props.onSelect(message)}
    >
      {unread && <div className={styles.unreadBar} />}
      <div className={styles.line}>
        <span className={mergeClasses(styles.sender, styles.ellipsis, unread && styles.unread)}>
          {message.from.name || message.from.address}
        </span>
        <span className={styles.icons}>
          {message.hasAttachments && <AttachRegular />}
          {message.isFlagged && <FlagFilled className={styles.flag} />}
        </span>
        <span className={mergeClasses(styles.time, unread && styles.unread)}>
          {formatListTime(message.receivedAt, props.now)}
        </span>
      </div>
      <div className={styles.line}>
        {props.folderName && <span className={styles.folder}>{props.folderName}</span>}
        <span className={mergeClasses(styles.ellipsis, styles.muted)}>{message.preview}</span>
      </div>
    </div>
  );
});
