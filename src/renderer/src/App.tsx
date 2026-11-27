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
import type { CoreInfo } from '@shared/api';
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

type CoreState = { info: CoreInfo } | { error: string } | undefined;

export function App() {
  const styles = useStyles();
  const dark = useSystemDarkMode();
  const [core, setCore] = useState<CoreState>();

  useEffect(() => {
    window.outlo
      .request('core.info', undefined)
      .then((info) => setCore({ info }))
      .catch((error: Error) => setCore({ error: error.message }));
  }, []);

  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme} className={styles.root}>
      <Title1>Outlo</Title1>
      {core === undefined && <Spinner label="Connecting to the core process" />}
      {core && 'info' in core && (
        <Body1>
          Core process is running (process {core.info.pid}, Node {core.info.nodeVersion}).
        </Body1>
      )}
      {core && 'error' in core && (
        <Body1 className={styles.error}>Core process failed: {core.error}</Body1>
      )}
    </FluentProvider>
  );
}
