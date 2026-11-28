import {
  Button,
  FluentProvider,
  makeStyles,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  tokens,
} from '@fluentui/react-components';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Account,
  FolderRole,
  ListFilter,
  MessageFilter,
  MoveRole,
  SessionInfo,
  TitleBarStyle,
  WebModule,
} from '@shared/api';
import { AddAccountDialog } from './accounts/AddAccountDialog';
import { RemoveAccountDialog } from './accounts/RemoveAccountDialog';
import { WebAccountView } from './accounts/WebAccountView';
import { Welcome } from './accounts/Welcome';
import { useMessageList, type ListView } from './core/messageList';
import { useMailboxes } from './core/useFolders';
import { useMessage } from './core/useMessage';
import { useSession } from './core/useSession';
import { useSettings, type Settings } from './core/useSettings';
import { useSyncStatus } from './core/useSyncStatus';
import { t } from './i18n';
import { FolderPane } from './mail/FolderPane';
import { ConversationPane } from './mail/ConversationPane';
import { MessageList } from './mail/MessageList';
import { formatSort, parseSort } from './mail/sorting';
import { ReadingPane } from './mail/ReadingPane';
import { SearchResults } from './mail/SearchResults';
import { AppBar } from './shell/AppBar';
import { Ribbon } from './shell/Ribbon';
import { SettingsMenu } from './shell/SettingsMenu';
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
  useEffect(() => window.outlo.window.setTheme(themeChoice), [themeChoice]);

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
  const [show, setShow] = useState<ListFilter>('all');
  // The open message. Child: picked below its conversation, where it stands for itself only.
  const [selection, setSelection] = useState<{ id: number; child: boolean }>();
  const selectedId = selection?.id;
  const [search, setSearch] = useState('');
  const [foldersVisible, setFoldersVisible] = useState(true);
  // False: closed. True: add an account. An account: sign it in fully, to replace its web mode.
  const [addingAccount, setAddingAccount] = useState<boolean | Account>(false);
  const [chosenWebAccountId, setChosenWebAccountId] = useState<number>();
  // Which module each account in web mode shows, as reported by the main process.
  const [webModules, setWebModules] = useState<Record<number, WebModule>>({});
  useEffect(
    () =>
      window.outlo.web.onModule((accountId, module) =>
        setWebModules((current) => ({ ...current, [accountId]: module })),
      ),
    [],
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [removing, setRemoving] = useState<Account>();
  const setDemo = (demo: boolean) => void window.outlo.session.setDemo(demo);
  const [folderWidth, setFolderWidth] = useState(() => Number(settings.get('folderWidth', '240')));
  const [listWidth, setListWidth] = useState(() => Number(settings.get('listWidth', '360')));

  // Until the user picks a folder, show the first inbox.
  const folders = useMemo(() => mailboxes?.folders ?? [], [mailboxes?.folders]);
  const folder =
    folders.find((entry) => entry.id === chosenFolderId) ??
    folders.find((entry) => entry.role === 'inbox');
  const filter: MessageFilter = folder?.role === 'inbox' ? inboxFilter : 'all';
  // Each folder keeps its own sort. The filter is for the moment and ends with the folder.
  // Grouping into conversations holds for all folders, as in Outlook.
  const conversations = settings.get('conversations', 'on') === 'on';
  const setConversations = (on: boolean) => settings.set('conversations', on ? 'on' : 'off');
  const view: ListView = {
    show,
    sort: parseSort(settings.get(`sort.${folder?.id}`, '')),
    conversations,
  };
  const changeView = (next: ListView) => {
    setShow(next.show);
    if (folder) settings.set(`sort.${folder.id}`, formatSort(next.sort));
  };
  const folderNames = useMemo(
    () => new Map(folders.map((entry) => [entry.id, entry.name])),
    [folders],
  );
  const { source, state } = useMessageList(folder?.id, filter, view, selectedId);

  const opened = useMessage(selectedId);
  const message = selectedId === undefined ? null : opened.message;

  // Opening an unread message marks it as read, once per opening. While it stays open, the user
  // can mark it unread and it stays so.
  const openedId = useRef<number>(undefined);
  useEffect(() => {
    if (selectedId === undefined) openedId.current = undefined;
    if (!message || openedId.current === message.id) return;
    openedId.current = message.id;
    if (!message.isRead) {
      void window.outlo.request('messages.setRead', { ids: [message.id], isRead: true });
    }
  }, [message, selectedId]);

  const searching = search.trim() !== '';

  // What an action is for. In conversation view the row of a conversation stands for all its
  // messages in the folder, as in Outlook.
  const targets = async (): Promise<number[]> => {
    if (!message) return [];
    if (!conversations || selection?.child || searching || !folder || message.threadId === null) {
      return [message.id];
    }
    const all = await window.outlo
      .request('conversations.get', { messageId: message.id, folderId: folder.id })
      .catch(() => []);
    const ids = all.filter((entry) => entry.folderId === folder.id).map((entry) => entry.id);
    return ids.includes(message.id) ? ids : [message.id];
  };

  // Moves what the action is for. Then the next row of the list opens, as in Outlook.
  const moveAway = async (to: { folderId: number } | { role: MoveRole }) => {
    if (!message) return;
    const ids = await targets();
    if (!searching && source) {
      const offset =
        source.offsetOf(message.id, true) ??
        (message.threadId === null ? undefined : source.offsetOfThread(message.threadId, true));
      // Asking the list for a row loads its page, so only rows that exist are asked for.
      const next = [0, 1, -1]
        .map((step) => (offset === undefined ? -1 : offset + step))
        .filter((entry) => entry >= 0 && entry < (state?.total ?? 0))
        .map((entry) => source.get(entry))
        .find((entry) => entry && !ids.includes(entry.id));
      setSelection(next && { id: next.id, child: false });
    }
    if ('folderId' in to)
      await window.outlo.request('messages.move', { ids, folderId: to.folderId });
    else await window.outlo.request('messages.moveToRole', { ids, role: to.role });
  };
  const accountFolders = folders.filter((entry) => entry.accountId === message?.accountId);
  const roleOfMessage = folders.find((entry) => entry.id === message?.folderId)?.role;
  // A folder with that role exists for the message, and it is not in there already.
  const canMoveTo = (role: FolderRole) =>
    message != null &&
    roleOfMessage !== role &&
    accountFolders.some((entry) => entry.role === role);

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
          showSearch={!webAccount}
          search={search}
          onSearch={setSearch}
        >
          <SettingsMenu
            theme={themeChoice}
            onTheme={(choice) => settings.set('theme', choice)}
            titleBar={titleBar}
            onTitleBar={(style) => void window.outlo.window.setTitleBarStyle(style)}
            demo={session.demo}
            onDemo={setDemo}
            conversations={conversations}
            onConversations={setConversations}
            onOpenChange={setSettingsOpen}
          />
        </TitleBar>
        <div className={styles.body}>
          <AppBar
            dark={dark}
            web={
              webAccount && {
                module: webModules[webAccount.id] ?? 'mail',
                onOpen: (module) => window.outlo.web.open(webAccount.id, module),
              }
            }
          />
          <div className={styles.main}>
            {/* Outlook on the web brings its own ribbon, and this one would do nothing for it. */}
            {!webAccount && (
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
                // Deleting in Deleted Items would delete for good, which is not offered yet.
                onDelete={
                  canMoveTo('deleted') ? () => void moveAway({ role: 'deleted' }) : undefined
                }
                onArchive={
                  canMoveTo('archive') ? () => void moveAway({ role: 'archive' }) : undefined
                }
                junk={
                  roleOfMessage === 'junk'
                    ? canMoveTo('inbox') && {
                        notJunk: true,
                        onClick: () => void moveAway({ role: 'inbox' }),
                      }
                    : canMoveTo('junk') && {
                        notJunk: false,
                        onClick: () => void moveAway({ role: 'junk' }),
                      }
                }
                folders={message ? accountFolders : []}
                onMove={(folderId) => void moveAway({ folderId })}
                onTheme={(choice) => settings.set('theme', choice)}
                onTitleBar={(style) => void window.outlo.window.setTitleBarStyle(style)}
                demo={session.demo}
                onDemo={setDemo}
                conversations={conversations}
                onConversations={setConversations}
              />
            )}
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
                {/* Without the ribbon there is no button to bring the pane back, and it is the
                    only way to leave a web account. So it stays while one is open. */}
                {(foldersVisible || webAccount) && mailboxes && (
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
                          setSelection(undefined);
                          setShow('all');
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
                    covered={addingAccount !== false || removing !== undefined || settingsOpen}
                    // Only once Outlook is open, and only where the app is dark: a light app
                    // matches the light Outlook that Microsoft starts with.
                    themeTip={
                      dark &&
                      webModules[webAccount.id] !== undefined &&
                      settings.get(`webThemeTip.${webAccount.id}`, '') !== 'done'
                    }
                    onThemeTipDone={() => settings.set(`webThemeTip.${webAccount.id}`, 'done')}
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
                          onSelect={(selected) => setSelection({ id: selected.id, child: false })}
                        />
                      ) : (
                        <MessageList
                          folder={folder}
                          folders={folders}
                          filter={filter}
                          view={view}
                          source={source}
                          state={state}
                          selectedId={selectedId}
                          selectedChild={selection?.child === true}
                          onFilter={setInboxFilter}
                          onView={changeView}
                          onSelect={(selected, child) => setSelection({ id: selected.id, child })}
                          onDelete={
                            canMoveTo('deleted')
                              ? () => void moveAway({ role: 'deleted' })
                              : undefined
                          }
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
                      {conversations ? (
                        <ConversationPane
                          selected={{ ...opened, message }}
                          dark={dark}
                          listFolderId={searching ? undefined : folder?.id}
                          folderNames={folderNames}
                        />
                      ) : (
                        <ReadingPane open={{ ...opened, message }} dark={dark} />
                      )}
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
