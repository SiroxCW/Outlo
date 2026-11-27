import { makeStyles, tokens } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import type { MessageSummary } from '@shared/api';
import { t } from '../i18n';
import { MessageRow } from './MessageRow';

const RESULT_LIMIT = 200;
const TYPING_PAUSE = 150;

const useStyles = makeStyles({
  root: { height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 },
  header: {
    flexShrink: 0,
    height: '44px',
    display: 'flex',
    alignItems: 'center',
    padding: '0 24px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  scroll: { flexGrow: 1, overflowY: 'auto' },
  empty: { padding: '24px', color: tokens.colorNeutralForeground3 },
});

interface SearchResultsProps {
  query: string;
  selectedId: number | undefined;
  onSelect(message: MessageSummary): void;
}

// The message list while the user searches: matches from all accounts, newest first.
export function SearchResults({ query, selectedId, onSelect }: SearchResultsProps) {
  const styles = useStyles();
  const [results, setResults] = useState<MessageSummary[]>();
  const now = new Date();

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void window.outlo
        .request('messages.search', { query, limit: RESULT_LIMIT })
        .then((found) => current && setResults(found));
    }, TYPING_PAUSE);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <section className={styles.root}>
      <div className={styles.header}>{t('search.results')}</div>
      <div className={styles.scroll} role="listbox">
        {results?.length === 0 && <div className={styles.empty}>{t('search.none')}</div>}
        {results?.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            selected={message.id === selectedId}
            showRecipient={false}
            now={now}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
