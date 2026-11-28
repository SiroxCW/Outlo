import {
  Button,
  FluentProvider,
  makeStyles,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  tokens,
} from '@fluentui/react-components';
import { useEffect, useRef, useState } from 'react';
import type { Account, MessageFilter, SessionInfo, TitleBarStyle } from '@shared/api';
import { AddAccountDialog } from './accounts/AddAccountDialog';
import { RemoveAccountDialog } from './accounts/RemoveAccountDialog';
import { WebAccountView } from './accounts/WebAccountView';
import { Welcome } from './accounts/Welcome';
import { useMessageList } from './core/messageList';
import { useMailboxes } from './core/useFolders';
import { useMessage } from './core/useMessage';
import { useSession } from './core/useSession';
import { useSettings, type Settings } from './core/useSettings';
import { useSyncStatus } from './core/useSyncStatus';
import { t } from './i18n';
import { FolderPane } from './mail/FolderPane';
import { MessageList } from './mail/MessageList';
import { ReadingPane } from './mail/ReadingPane';
import { SearchResults } from './mail/SearchResults';
import { AppBar } from './shell/AppBar';
import { Ribbon } from './shell/Ribbon';
import { Splitter } from './shell/Splitter';
import { TitleBar } from './shell/TitleBar';
import { barBackground, darkTheme, lightTheme, THEME_CHOICES, type ThemeChoice } from './theme';
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
  banner: { flexShrink: 0, margin: '8px 8px 0' },
  error: { padding: '24px', color: tokens.colorPaletteRedForeground1 },
});

function Shell({ settings, session }: { settings: Settings; session: SessionInfo }) {
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
      background: barBackground(dark),
      symbols: theme.colorNeutralForeground1,
    });
  }, [theme, dark]);

  const { mailboxes, error } = useMailboxes();
  const syncStatus = useSyncStatus();
  const [chosenFolderId, setChosenFolderId] = useState<number>();
  const [inboxFilter, setInboxFilter] = useState<MessageFilter>('focused');
  const [selectedId, setSelectedId] = useState<number>();
  const [search, setSearch] = useState('');
  const [foldersVisible, setFoldersVisible] = useState(true);
  // False: closed. True: add an account. An account: sign it in fully, to replace its web mode.
  const [addingAccount, setAddingAccount] = useState<boolean | Account>(false);
  const [chosenWebAccountId, setChosenWebAccountId] = useState<number>();
  const [removing, setRemoving] = useState<Account>();
  const setDemo = (demo: boolean) => void window.outlo.session.setDemo(demo);
  const [folderWidth, setFolderWidth] = useState(() => Number(settings.get('folderWidth', '240')));
  const [listWidth, setListWidth] = useState(() => Number(settings.get('listWidth', '360')));

  // Until the user picks a folder, show the first inbox.
  const folders = mailboxes?.folders ?? [];
  const folder =
    folders.find((entry) => entry.id === chosenFolderId) ??
    folders.find((entry) => entry.role === 'inbox');
  const filter: MessageFilter = folder?.role === 'inbox' ? inboxFilter : 'all';
  const { source, state } = useMessageList(folder?.id, filter);

  const opened = useMessage(selectedId);
  const message = selectedId === undefined ? null : opened.message;

  // Opening an unread message marks it as read, once. The user can mark it unread again.
  // Changes are not sent to mail providers yet, so only demo mail can be changed for now.
  const provider = mailboxes?.accounts.find((entry) => entry.id === message?.accountId)?.provider;
  const editable = provider === 'demo';
  const markedAsRead = useRef<number>(undefined);
  useEffect(() => {
    if (!message || !editable || message.isRead || markedAsRead.current === message.id) return;
    markedAsRead.current = message.id;
    void window.outlo.request('messages.setRead', { ids: [message.id], isRead: true });
  }, [message, editable]);

  const searching = search.trim() !== '';
  // An account in web mode is shown when the user picked it, or when there is no mail to show.
  const webAccounts = mailboxes?.accounts.filter((entry) => entry.provider === 'web') ?? [];
  // Right after an account was added, the list of accounts does not contain it yet. Showing
  // another account for that moment would load a page nobody asked for.
  const chosenArrived =
    chosenWebAccountId === undefined ||
    mailboxes?.accounts.some((entry) => entry.id === chosenWebAccountId) === true;
  const webAccount =
    searching || !chosenArrived
      ? undefined
      : (webAccounts.find((entry) => entry.id === chosenWebAccountId) ??
        (folders.length === 0 ? webAccounts[0] : undefined));
  const noAccounts = !session.demo && mailboxes?.accounts.length === 0;
  return (
    // No class of our own on the provider: Fluent copies the provider's classes to the layer
    // that holds menus and dialogs, and a layout class there would cover the whole window.
    <FluentProvider theme={theme} style={{ height: '100%' }}>
      <div className={styles.root}>
        <TitleBar
          customFrame={titleBar === 'custom'}
          dark={dark}
          search={search}
          onSearch={setSearch}
        />
        <div className={styles.body}>
          <AppBar dark={dark} />
          <div className={styles.main}>
            <Ribbon
              message={editable ? message : null}
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
              demo={session.demo}
              onDemo={setDemo}
            />
            {session.demo && (
              <MessageBar className={styles.banner}>
                <MessageBarBody>{t('demo.banner')}</MessageBarBody>
                <MessageBarActions>
                  <Button size="small" onClick={() => setDemo(false)}>
                    {t('demo.leave')}
                  </Button>
                </MessageBarActions>
              </MessageBar>
            )}
            {noAccounts ? (
              <div className={styles.content}>
                <Welcome onAddAccount={() => setAddingAccount(true)} onDemo={() => setDemo(true)} />
              </div>
            ) : (
              <div className={styles.content}>
                {foldersVisible && mailboxes && (
                  <>
                    <div className={styles.pane} style={{ width: folderWidth }}>
                      <FolderPane
                        mailboxes={mailboxes}
                        onAddAccount={session.demo ? undefined : () => setAddingAccount(true)}
                        onRemoveAccount={session.demo ? undefined : setRemoving}
                        syncStatus={syncStatus}
                        selectedFolderId={searching || webAccount ? undefined : folder?.id}
                        selectedWebAccountId={webAccount?.id}
                        onSelectWeb={(accountId) => {
                          setChosenWebAccountId(accountId);
                          setSearch('');
                        }}
                        onFullSignIn={setAddingAccount}
                        onSelect={(folderId) => {
                          setChosenWebAccountId(undefined);
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
                {webAccount ? (
                  <WebAccountView
                    account={webAccount}
                    covered={addingAccount !== false || removing !== undefined}
                  />
                ) : (
                  <>
                    <div className={`${styles.pane} ${styles.card}`} style={{ width: listWidth }}>
                      {error && (
                        <div className={styles.error}>{`${t('error.core')}: ${error}`}</div>
                      )}
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
                      <ReadingPane open={{ ...opened, message }} dark={dark} />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {addingAccount && (
        <AddAccountDialog
          secureStorage={session.secureStorage}
          replaces={addingAccount === true ? undefined : addingAccount}
          onAdded={(accountId) => {
            setAddingAccount(false);
            setChosenWebAccountId(accountId);
          }}
          onClose={() => setAddingAccount(false)}
        />
      )}
      {removing && (
        <RemoveAccountDialog
          account={removing}
          // Forget the choice of a removed account, so the next one can take its place.
          onRemoved={() => {
            if (removing.id === chosenWebAccountId) setChosenWebAccountId(undefined);
          }}
          onClose={() => setRemoving(undefined)}
        />
      )}
    </FluentProvider>
  );
}

export function App() {
  // The settings decide the theme, so nothing is drawn before they have arrived.
  const settings = useSettings();
  const session = useSession();
  return settings && session ? <Shell settings={settings} session={session} /> : null;
}
