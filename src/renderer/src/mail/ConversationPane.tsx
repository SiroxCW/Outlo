import { Avatar, makeStyles, mergeClasses, Spinner, tokens } from '@fluentui/react-components';
import { useEffect, useRef, useState } from 'react';
import type { MessageSummary } from '@shared/api';
import { useConversation } from '../core/useConversation';
import { useMessage, type OpenMessage } from '../core/useMessage';
import { t } from '../i18n';
import { conversationTopic, formatListTime } from './format';
import { MessageCard } from './MessageCard';
import { ReadingPlaceholder } from './ReadingPane';
import { useReadingStyles } from './readingStyles';

const useStyles = makeStyles({
  stack: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    // Room for the shadows of the cards.
    padding: '2px 4px 12px',
    margin: '0 -4px',
  },
  folded: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 24px',
    border: 'none',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase300,
    textAlign: 'left',
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  foldedText: { flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  line: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  unread: { fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  folder: { color: tokens.colorBrandForeground1, fontSize: tokens.fontSizeBase200 },
  time: { flexShrink: 0, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  loading: { padding: '24px' },
});

interface ConversationPaneProps {
  // The message the user picked, in the list or below an open conversation.
  selected: OpenMessage;
  dark: boolean;
  // The folder the list shows. Messages in other folders are marked with their folder's name.
  // Search results have none, and then the folder of the picked message counts.
  listFolderId: number | undefined;
  folderNames: ReadonlyMap<number, string>;
}

// The whole conversation of the picked message, newest on top. As in Outlook, the picked
// message is open and at the top of the pane, the others are folded to one line.
export function ConversationPane({
  selected,
  dark,
  listFolderId,
  folderNames,
}: ConversationPaneProps) {
  const styles = useStyles();
  const reading = useReadingStyles();
  const message = selected.message;
  const home = listFolderId ?? message?.folderId;
  const loaded = useConversation(message?.id, home);
  const [unfolded, setUnfolded] = useState<{ for: number; ids: ReadonlySet<number> }>();
  const stackRef = useRef<HTMLDivElement>(null);
  const selectedCard = useRef<HTMLDivElement>(null);

  // Each pick starts with only the picked message open.
  if (message && unfolded?.for !== message.id) {
    setUnfolded({ for: message.id, ids: new Set([message.id]) });
  }
  const open = unfolded && unfolded.for === message?.id ? unfolded.ids : undefined;
  // A very long conversation may end before the picked message. It is shown alone then.
  const messages =
    message && loaded && !loaded.some((entry) => entry.id === message.id) ? [message] : loaded;

  // The picked message is brought to the top. Its text and the cards around it take their
  // height a moment later, so it is held there until the user scrolls.
  const ready = message !== null && message !== undefined && messages !== undefined;
  const pickedId = message?.id;
  useEffect(() => {
    const stack = stackRef.current;
    const card = selectedCard.current;
    if (!ready || !stack || !card) return;
    let follow = true;
    const stop = () => {
      follow = false;
    };
    const align = () => {
      if (!follow) return;
      const top = card.getBoundingClientRect().top - stack.getBoundingClientRect().top;
      stack.scrollTop += top - parseFloat(getComputedStyle(stack).paddingTop);
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(card);
    observer.observe(stack);
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    for (const name of events) stack.addEventListener(name, stop, { passive: true });
    return () => {
      observer.disconnect();
      for (const name of events) stack.removeEventListener(name, stop);
    };
  }, [ready, pickedId]);

  if (!message) return <ReadingPlaceholder loading={message === undefined} />;

  const toggle = (id: number) =>
    setUnfolded((current) => {
      if (!current) return current;
      const ids = new Set(current.ids);
      if (!ids.delete(id)) ids.add(id);
      return { for: current.for, ids };
    });
  const several = (messages?.length ?? 1) > 1;
  const folderOf = (entry: MessageSummary) =>
    entry.folderId === home ? undefined : folderNames.get(entry.folderId);

  return (
    <article className={reading.root}>
      <h1 className={reading.subject}>
        {conversationTopic(message.subject) || t('reading.noSubject')}
      </h1>
      <div ref={stackRef} className={styles.stack}>
        {!messages || !open ? (
          <Spinner className={styles.loading} size="tiny" label={t('reading.loading')} />
        ) : (
          messages.map((entry) => {
            const onHeaderClick = several ? () => toggle(entry.id) : undefined;
            if (!open.has(entry.id)) {
              return (
                <FoldedMessage
                  key={entry.id}
                  message={entry}
                  folderName={folderOf(entry)}
                  onOpen={() => toggle(entry.id)}
                />
              );
            }
            if (entry.id === message.id) {
              return (
                <div key={entry.id} ref={selectedCard}>
                  <MessageCard
                    open={selected}
                    message={message}
                    dark={dark}
                    size="fit"
                    folderName={folderOf(entry)}
                    onHeaderClick={onHeaderClick}
                  />
                </div>
              );
            }
            return (
              <LoadedCard
                key={entry.id}
                id={entry.id}
                dark={dark}
                folderName={folderOf(entry)}
                onHeaderClick={onHeaderClick}
              />
            );
          })
        )}
      </div>
    </article>
  );
}

interface FoldedMessageProps {
  message: MessageSummary;
  folderName: string | undefined;
  onOpen(): void;
}

function FoldedMessage({ message, folderName, onOpen }: FoldedMessageProps) {
  const styles = useStyles();
  const sender = message.from.name || message.from.address;
  return (
    <button type="button" className={styles.folded} onClick={onOpen}>
      <Avatar name={sender} color="colorful" size={32} />
      <span className={styles.foldedText}>
        <span className={mergeClasses(styles.line, !message.isRead && styles.unread)}>
          {sender}
        </span>
        <span className={mergeClasses(styles.line, styles.muted)}>
          {folderName && <span className={styles.folder}>{folderName} </span>}
          {message.preview}
        </span>
      </span>
      <span className={styles.time}>{formatListTime(message.receivedAt, new Date())}</span>
    </button>
  );
}

interface LoadedCardProps {
  id: number;
  dark: boolean;
  folderName: string | undefined;
  onHeaderClick: (() => void) | undefined;
}

// An open message of the conversation other than the picked one, which the app loads already.
function LoadedCard({ id, dark, folderName, onHeaderClick }: LoadedCardProps) {
  const styles = useStyles();
  const open = useMessage(id);
  const { message } = open;

  // Opening an unread message marks it as read, once per opening, like the picked one.
  const opened = useRef(false);
  useEffect(() => {
    if (!message || opened.current) return;
    opened.current = true;
    if (!message.isRead) {
      void window.outlo.request('messages.setRead', { ids: [message.id], isRead: true });
    }
  }, [message]);

  if (!message) return <Spinner className={styles.loading} size="tiny" />;
  return (
    <MessageCard
      open={open}
      message={message}
      dark={dark}
      size="fit"
      folderName={folderName}
      onHeaderClick={onHeaderClick}
    />
  );
}
