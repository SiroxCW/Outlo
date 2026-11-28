import { makeStyles, mergeClasses, Tab, TabList, tokens } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Folder, ListEntry, MessageFilter, MessageSummary } from '@shared/api';
import { useCoreEvents } from '../core/events';
import type { ListView, MessageListSource, MessageListState } from '../core/messageList';
import { t } from '../i18n';
import { createListLayout, expandRow, type ListRow } from './listLayout';
import { ListMenus } from './ListMenus';
import { CHILD_ROW_HEIGHT, ChildRow, MESSAGE_ROW_HEIGHT, MessageRow } from './MessageRow';

const HEADER_ROW_HEIGHT = 32;
const ROW_HEIGHTS: Record<ListRow['kind'], number> = {
  header: HEADER_ROW_HEIGHT,
  message: MESSAGE_ROW_HEIGHT,
  child: CHILD_ROW_HEIGHT,
};
const FALLBACK_NOW = new Date();

interface OpenConversation {
  threadId: number;
  // Where its row was last seen.
  offset: number;
  messages: MessageSummary[];
}

const useStyles = makeStyles({
  root: { height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 },
  header: {
    flexShrink: 0,
    height: '44px',
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px 0 24px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  title: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  scroll: { flexGrow: 1, overflowY: 'auto', outlineStyle: 'none', position: 'relative' },
  row: { position: 'absolute', top: 0, left: 0, width: '100%' },
  group: {
    height: `${HEADER_ROW_HEIGHT}px`,
    width: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '0 12px',
    border: 'none',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textAlign: 'left',
  },
  chevron: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
  },
  empty: {
    flexGrow: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForeground3,
  },
});

interface MessageListProps {
  folder: Folder | undefined;
  // All folders, to name the one a message of a conversation lies in.
  folders: Folder[];
  filter: MessageFilter;
  view: ListView;
  source: MessageListSource | undefined;
  state: MessageListState | undefined;
  selectedId: number | undefined;
  onFilter(filter: MessageFilter): void;
  onView(view: ListView): void;
  onSelect(message: MessageSummary): void;
}

export function MessageList(props: MessageListProps) {
  const styles = useStyles();
  const { folder, view, source, state, selectedId } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const selectedOffset = useRef<number>(undefined);
  // The conversation whose messages are shown below its row. One at a time.
  const [open, setOpen] = useState<OpenConversation>();
  // The newest message of an open conversation has two rows: the conversation's and its own.
  // Only the one the user clicked is marked.
  const [pickedChild, setPickedChild] = useState(false);
  const folderNames = useMemo(
    () => new Map(props.folders.map((entry) => [entry.id, entry.name])),
    [props.folders],
  );

  // New mail moves the rows, so the row of the open conversation is looked up again.
  const openOffset =
    open && source
      ? source.get(open.offset)?.threadId === open.threadId
        ? open.offset
        : source.offsetOfThread(open.threadId)
      : undefined;
  const openSize = open?.messages.length ?? 0;
  const layout = useMemo(() => {
    const plain = createListLayout(state?.groups ?? [], collapsed);
    return openOffset === undefined ? plain : expandRow(plain, openOffset, openSize);
  }, [state?.groups, collapsed, openOffset, openSize]);
  // The React Compiler is not in use, so its warning about this library does not apply.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: layout.rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => ROW_HEIGHTS[layout.rowAt(index).kind],
    overscan: 6,
  });
  // Rows can change their kind at the same position, so the sizes are worked out again.
  useEffect(() => virtualizer.measure(), [layout, virtualizer]);

  // A different folder starts at the top again.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    selectedOffset.current = undefined;
    setOpen(undefined);
  }, [source]);

  const loadConversation = useCallback(async (message: MessageSummary, offset: number) => {
    if (message.threadId === null) return;
    const messages = await window.outlo
      .request('conversations.get', { messageId: message.id, folderId: message.folderId })
      .catch(() => []);
    setOpen(messages.length > 1 ? { threadId: message.threadId, offset, messages } : undefined);
  }, []);
  const toggleConversation = (message: ListEntry, offset: number) => {
    if (open?.threadId === message.threadId) setOpen(undefined);
    else void loadConversation(message, offset);
  };
  // An open conversation follows changes, like an answer that arrives.
  useCoreEvents(
    (event) => event.type === 'messages.changed' && open !== undefined,
    () => {
      if (!open) return;
      const head = source?.get(openOffset ?? open.offset);
      void loadConversation(
        head?.threadId === open.threadId ? head : open.messages[0]!,
        openOffset ?? open.offset,
      );
    },
  );

  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const select = (message: MessageSummary, offset: number, child = false) => {
    selectedOffset.current = offset;
    setPickedChild(child);
    props.onSelect(message);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || !source || !state || state.total === 0) return;
    event.preventDefault();

    // A filtered list drops the message that was open before, so the open one may have moved.
    let current = selectedOffset.current;
    if (
      current !== undefined &&
      selectedId !== undefined &&
      source.get(current)?.id !== selectedId
    ) {
      current = source.offsetOf(selectedId) ?? current;
    }
    const offset = Math.min(
      state.total - 1,
      Math.max(0, current === undefined ? 0 : current + step),
    );
    const message = source.get(offset);
    if (!message) return;
    select(message, offset);
    const row = layout.rowOfOffset(offset);
    if (row !== null) virtualizer.scrollToIndex(row);
  };

  const isInbox = folder?.role === 'inbox';
  return (
    <section className={styles.root}>
      <div className={styles.header}>
        {isInbox ? (
          <TabList
            size="small"
            selectedValue={props.filter}
            onTabSelect={(_event, data) => props.onFilter(data.value as MessageFilter)}
          >
            <Tab value="focused">{t('list.focused')}</Tab>
            <Tab value="other">{t('list.other')}</Tab>
          </TabList>
        ) : (
          <span className={styles.title}>{folder?.name}</span>
        )}
        <ListMenus
          show={view.show}
          sort={view.sort}
          onShow={(show) => props.onView({ ...view, show })}
          onSort={(sort) => props.onView({ ...view, sort })}
        />
      </div>

      {state?.loaded && state.total === 0 ? (
        <div className={styles.empty}>
          {t(view.show === 'all' ? 'list.empty' : 'list.emptyFiltered')}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={styles.scroll}
          role="listbox"
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <div style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = layout.rowAt(item.index);
              const style = { transform: `translateY(${item.start}px)` };
              if (row.kind === 'header') {
                return (
                  <button
                    key={`group-${row.group.key}`}
                    type="button"
                    className={mergeClasses(styles.row, styles.group)}
                    style={style}
                    onClick={() => toggleGroup(row.group.key)}
                  >
                    <span className={styles.chevron}>
                      {collapsed.has(row.group.key) ? (
                        <ChevronRightRegular />
                      ) : (
                        <ChevronDownRegular />
                      )}
                    </span>
                    {row.group.label}
                  </button>
                );
              }
              if (row.kind === 'child') {
                const child = open!.messages[row.index]!;
                const isHead = source?.get(row.offset)?.id === child.id;
                return (
                  <div key={`child-${child.id}`} className={styles.row} style={style}>
                    <ChildRow
                      message={child}
                      folderName={
                        child.folderId === folder?.id ? undefined : folderNames.get(child.folderId)
                      }
                      selected={child.id === selectedId && (pickedChild || !isHead)}
                      now={state?.now ?? FALLBACK_NOW}
                      onSelect={(selected) => select(selected, row.offset, true)}
                    />
                  </div>
                );
              }
              const message = source?.get(row.offset);
              const expanded = message?.threadId != null && message.threadId === open?.threadId;
              return (
                <div key={`message-${row.offset}`} className={styles.row} style={style}>
                  <MessageRow
                    message={message}
                    selected={
                      message !== undefined &&
                      message.id === selectedId &&
                      !(expanded && pickedChild)
                    }
                    showRecipient={folder?.role === 'sent' || folder?.role === 'drafts'}
                    now={state?.now ?? FALLBACK_NOW}
                    onSelect={(selected) => select(selected, row.offset)}
                    expanded={expanded}
                    onToggle={(entry) => toggleConversation(entry, row.offset)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
