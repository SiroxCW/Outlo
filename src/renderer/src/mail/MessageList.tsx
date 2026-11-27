import { makeStyles, mergeClasses, Tab, TabList, tokens } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Folder, MessageFilter, MessageSummary } from '@shared/api';
import type { MessageListSource, MessageListState } from '../core/messageList';
import { t } from '../i18n';
import { createListLayout } from './listLayout';
import { MESSAGE_ROW_HEIGHT, MessageRow } from './MessageRow';

const HEADER_ROW_HEIGHT = 32;
const FALLBACK_NOW = new Date();

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
  filter: MessageFilter;
  source: MessageListSource | undefined;
  state: MessageListState | undefined;
  selectedId: number | undefined;
  onFilter(filter: MessageFilter): void;
  onSelect(message: MessageSummary): void;
}

export function MessageList(props: MessageListProps) {
  const styles = useStyles();
  const { folder, source, state, selectedId } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const selectedOffset = useRef<number>(undefined);

  const layout = useMemo(
    () => createListLayout(state?.groups ?? [], collapsed),
    [state?.groups, collapsed],
  );
  // The React Compiler is not in use, so its warning about this library does not apply.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: layout.rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      layout.rowAt(index).kind === 'header' ? HEADER_ROW_HEIGHT : MESSAGE_ROW_HEIGHT,
    overscan: 6,
  });

  // A different folder starts at the top again.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    selectedOffset.current = undefined;
  }, [source]);

  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const select = (message: MessageSummary, offset: number) => {
    selectedOffset.current = offset;
    props.onSelect(message);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || !source || !state || state.total === 0) return;
    event.preventDefault();

    const current = selectedOffset.current;
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
      </div>

      {state?.loaded && state.total === 0 ? (
        <div className={styles.empty}>{t('list.empty')}</div>
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
              const message = source?.get(row.offset);
              return (
                <div key={`message-${row.offset}`} className={styles.row} style={style}>
                  <MessageRow
                    message={message}
                    selected={message !== undefined && message.id === selectedId}
                    showRecipient={folder?.role === 'sent' || folder?.role === 'drafts'}
                    now={state?.now ?? FALLBACK_NOW}
                    onSelect={(selected) => select(selected, row.offset)}
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
