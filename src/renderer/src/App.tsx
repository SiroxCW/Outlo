import { FluentProvider, makeStyles, tokens } from '@fluentui/react-components';
import { useEffect, useRef, useState } from 'react';
import type { MessageFilter, TitleBarStyle } from '@shared/api';
import { useMessageList } from './core/messageList';
import { useMailboxes } from './core/useFolders';
import { useMessage } from './core/useMessage';
import { useSettings, type Settings } from './core/useSettings';
import { t } from './i18n';
import { FolderPane } from './mail/FolderPane';
import { MessageList } from './mail/MessageList';
import { ReadingPane } from './mail/ReadingPane';
import { SearchResults } from './mail/SearchResults';
import { AppBar } from './shell/AppBar';
import { Ribbon } from './shell/Ribbon';
import { Splitter } from './shell/Splitter';
import { TitleBar } from './shell/TitleBar';
import { darkTheme, lightTheme, THEME_CHOICES, type ThemeChoice } from './theme';
import { useSystemDarkMode } from './useSystemDarkMode';

const useStyles = makeStyles({
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: tokens.colorNeutralBackground3,
  },
  body: { flexGrow: 1, display: 'flex', minHeight: 0 },
  main: { flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  content: { flexGrow: 1, display: 'flex', minHeight: 0, padding: '8px 8px 8px 0' },
  pane: { flexShrink: 0, minWidth: 0 },
  card: {
    minWidth: 0,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  reading: { flexGrow: 1, minWidth: 0 },
  error: { padding: '24px', color: tokens.colorPaletteRedForeground1 },
});

function Shell({ settings }: { settings: Settings }) {
  const styles = useStyles();
  const systemDark = useSystemDarkMode();
  const saved = settings.get('theme', 'system') as ThemeChoice;
  const themeChoice = THEME_CHOICES.includes(saved) ? saved : 'system';
  const dark = themeChoice === 'system' ? systemDark : themeChoice === 'dark';
  const theme = dark ? darkTheme : lightTheme;
  // Makes the scroll bars and other built-in controls follow the theme.
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);

  const [titleBar, setTitleBar] = useState<TitleBarStyle>('custom');
  useEffect(() => {
    void window.outlo.window.getTitleBarStyle().then(setTitleBar);
  }, []);
  useEffect(() => {
    window.outlo.window.setTitleBarColors({
      background: theme.colorNeutralBackground3,
      symbols: theme.colorNeutralForeground1,
    });
  }, [theme]);

  const { mailboxes, error } = useMailboxes();
  const [chosenFolderId, setChosenFolderId] = useState<number>();
  const [inboxFilter, setInboxFilter] = useState<MessageFilter>('focused');
  const [selectedId, setSelectedId] = useState<number>();
  const [search, setSearch] = useState('');
  const [foldersVisible, setFoldersVisible] = useState(true);
  const [folderWidth, setFolderWidth] = useState(() => Number(settings.get('folderWidth', '240')));
  const [listWidth, setListWidth] = useState(() => Number(settings.get('listWidth', '360')));

  // Until the user picks a folder, show the first inbox.
  const folders = mailboxes?.folders ?? [];
  const folder =
    folders.find((entry) => entry.id === chosenFolderId) ??
    folders.find((entry) => entry.role === 'inbox');
  const filter: MessageFilter = folder?.role === 'inbox' ? inboxFilter : 'all';
  const { source, state } = useMessageList(folder?.id, filter);

  const loaded = useMessage(selectedId);
  const message = selectedId === undefined ? null : loaded;

  // Opening an unread message marks it as read, once. The user can mark it unread again.
  const markedAsRead = useRef<number>(undefined);
  useEffect(() => {
    if (!message || message.isRead || markedAsRead.current === message.id) return;
    markedAsRead.current = message.id;
    void window.outlo.request('messages.setRead', { ids: [message.id], isRead: true });
  }, [message]);

  const searching = search.trim() !== '';
  return (
    <FluentProvider theme={theme} className={styles.root}>
      <TitleBar customFrame={titleBar === 'custom'} search={search} onSearch={setSearch} />
      <div className={styles.body}>
        <AppBar />
        <div className={styles.main}>
          <Ribbon
            message={message}
            theme={themeChoice}
            titleBar={titleBar}
            onToggleFolders={() => setFoldersVisible((visible) => !visible)}
            onSetRead={(isRead) =>
              message &&
              void window.outlo.request('messages.setRead', { ids: [message.id], isRead })
            }
            onSetFlagged={(isFlagged) =>
              message &&
              void window.outlo.request('messages.setFlagged', { ids: [message.id], isFlagged })
            }
            onTheme={(choice) => settings.set('theme', choice)}
            onTitleBar={(style) => void window.outlo.window.setTitleBarStyle(style)}
          />
          <div className={styles.content}>
            {foldersVisible && mailboxes && (
              <>
                <div className={styles.pane} style={{ width: folderWidth }}>
                  <FolderPane
                    mailboxes={mailboxes}
                    selectedFolderId={searching ? undefined : folder?.id}
                    onSelect={(folderId) => {
                      setChosenFolderId(folderId);
                      setSelectedId(undefined);
                      setSearch('');
                    }}
                  />
                </div>
                <Splitter
                  width={folderWidth}
                  min={160}
                  max={420}
                  onResize={setFolderWidth}
                  onCommit={(width) => settings.set('folderWidth', String(width))}
                />
              </>
            )}
            <div className={`${styles.pane} ${styles.card}`} style={{ width: listWidth }}>
              {error && <div className={styles.error}>{`${t('error.core')}: ${error}`}</div>}
              {searching ? (
                <SearchResults
                  query={search}
                  selectedId={selectedId}
                  onSelect={(selected) => setSelectedId(selected.id)}
                />
              ) : (
                <MessageList
                  folder={folder}
                  filter={filter}
                  source={source}
                  state={state}
                  selectedId={selectedId}
                  onFilter={setInboxFilter}
                  onSelect={(selected) => setSelectedId(selected.id)}
                />
              )}
            </div>
            <Splitter
              width={listWidth}
              min={280}
              max={720}
              onResize={setListWidth}
              onCommit={(width) => settings.set('listWidth', String(width))}
            />
            <div className={styles.reading}>
              <ReadingPane message={message} dark={dark} />
            </div>
          </div>
        </div>
      </div>
    </FluentProvider>
  );
}

export function App() {
  // The settings decide the theme, so nothing is drawn before they have arrived.
  const settings = useSettings();
  return settings ? <Shell settings={settings} /> : null;
}
