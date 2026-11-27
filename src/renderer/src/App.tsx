import {
  Body1,
  FluentProvider,
  makeStyles,
  Spinner,
  Title1,
  tokens,
  webDarkTheme,
  webLightTheme,
} from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { useSystemDarkMode } from './useSystemDarkMode';

const useStyles = makeStyles({
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
  },
});

interface Totals {
  accounts: number;
  folders: number;
  messages: number;
  unread: number;
}

async function loadTotals(): Promise<Totals> {
  const [accounts, folders] = await Promise.all([
    window.outlo.request('accounts.list', undefined),
    window.outlo.request('folders.list', undefined),
  ]);
  return {
    accounts: accounts.length,
    folders: folders.length,
    messages: folders.reduce((sum, folder) => sum + folder.totalCount, 0),
    unread: folders.reduce((sum, folder) => sum + folder.unreadCount, 0),
  };
}

// Placeholder until the real layout exists. It shows that queries and change events arrive.
export function App() {
  const styles = useStyles();
  const dark = useSystemDarkMode();
  const [totals, setTotals] = useState<Totals>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const refresh = () =>
      loadTotals()
        .then(setTotals)
        .catch((reason: Error) => setError(reason.message));
    void refresh();
    return window.outlo.subscribe(() => void refresh());
  }, []);

  const count = (value: number) => value.toLocaleString('en-US');
  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme} className={styles.root}>
      <Title1>Outlo</Title1>
      {!totals && !error && <Spinner label="Connecting to the core process" />}
      {totals && (
        <Body1>
          Demo data: {count(totals.accounts)} accounts, {count(totals.folders)} folders,{' '}
          {count(totals.messages)} messages, {count(totals.unread)} unread.
        </Body1>
      )}
      {error && <Body1 className={styles.error}>Core process failed: {error}</Body1>}
    </FluentProvider>
  );
}
