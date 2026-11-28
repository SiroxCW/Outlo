import {
  Button,
  makeStyles,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  mergeClasses,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import {
  ArchiveRegular,
  ArrowClockwiseRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DeleteRegular,
  DraftsRegular,
  FolderProhibitedRegular,
  FolderRegular,
  GlobeRegular,
  MailArrowUpRegular,
  MailInboxRegular,
  MoreHorizontalRegular,
  PersonAddRegular,
  PersonKeyRegular,
  SendRegular,
} from '@fluentui/react-icons';
import { useState, type ReactElement } from 'react';
import type { Account, AccountSyncStatus, Folder, FolderRole } from '@shared/api';
import type { Mailboxes } from '../core/useFolders';
import { t } from '../i18n';

const useStyles = makeStyles({
  root: { height: '100%', overflowY: 'auto', padding: '4px 0 8px 8px', boxSizing: 'border-box' },
  row: {
    width: '100%',
    // Lets a long name shrink next to the menu button, where it would push the pane wider.
    minWidth: 0,
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    border: 'none',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground1,
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase300,
    textAlign: 'left',
    ':hover:enabled': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':disabled': { color: tokens.colorNeutralForegroundDisabled },
  },
  section: { fontWeight: tokens.fontWeightSemibold, paddingLeft: '8px' },
  selected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    fontWeight: tokens.fontWeightSemibold,
    ':hover:enabled': { backgroundColor: tokens.colorNeutralBackground1Selected },
  },
  icon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    flexShrink: 0,
  },
  chevron: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
  },
  name: { flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  count: { paddingRight: '10px', fontSize: tokens.fontSizeBase200 },
  unread: { color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
  sectionRow: { display: 'flex', alignItems: 'center', paddingRight: '4px' },
  status: {
    padding: '2px 8px 4px 28px',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    overflowWrap: 'anywhere',
  },
  problem: { color: tokens.colorPaletteRedForeground1 },
  link: {
    display: 'block',
    padding: 0,
    border: 'none',
    backgroundColor: 'transparent',
    color: tokens.colorBrandForegroundLink,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    ':hover': { textDecorationLine: 'underline' },
  },
  badge: {
    flexShrink: 0,
    padding: '0 6px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground5,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase100,
    lineHeight: '16px',
  },
  none: { padding: '4px 0 4px 28px', color: tokens.colorNeutralForeground3 },
  divider: { height: '1px', margin: '8px 8px 8px 0', backgroundColor: tokens.colorNeutralStroke2 },
});

const ROLE_ICONS: Record<FolderRole, ReactElement> = {
  inbox: <MailInboxRegular />,
  drafts: <DraftsRegular />,
  sent: <SendRegular />,
  deleted: <DeleteRegular />,
  junk: <FolderProhibitedRegular />,
  archive: <ArchiveRegular />,
  outbox: <MailArrowUpRegular />,
};

interface FolderPaneProps {
  mailboxes: Mailboxes;
  selectedFolderId: number | undefined;
  onSelect(folderId: number): void;
  // Missing in the demo, where accounts cannot be added or removed.
  onAddAccount?: () => void;
  onRemoveAccount?: (account: Account) => void;
  // For accounts in web mode: which one is open, opening one, and the try to sign it in fully.
  selectedWebAccountId: number | undefined;
  onSelectWeb(accountId: number): void;
  onFullSignIn?: (account: Account) => void;
  syncStatus: AccountSyncStatus[];
}

export function FolderPane(props: FolderPaneProps) {
  const { mailboxes, selectedFolderId, onSelect, onAddAccount, onRemoveAccount } = props;
  const stateOf = (account: Account) =>
    props.syncStatus.find((status) => status.accountId === account.id);
  const styles = useStyles();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const children = (parentId: number | null, accountId: number) =>
    mailboxes.folders.filter(
      (folder) => folder.accountId === accountId && folder.parentId === parentId,
    );
  const accountEmail = (accountId: number) =>
    mailboxes.accounts.find((account) => account.id === accountId)?.email ?? '';

  const section = (key: string, label: string, account?: Account) => (
    <div className={styles.sectionRow}>
      <button
        type="button"
        className={mergeClasses(styles.row, styles.section)}
        onClick={() => toggle(key)}
      >
        <span className={styles.chevron}>
          {collapsed.has(key) ? <ChevronRightRegular /> : <ChevronDownRegular />}
        </span>
        <span className={styles.name}>{label}</span>
      </button>
      {account?.provider === 'web' && <span className={styles.badge}>{t('folders.webBadge')}</span>}
      {account && stateOf(account)?.state === 'syncing' && (
        <Spinner size="extra-tiny" aria-label={t('sync.syncing')} />
      )}
      {account && onRemoveAccount && (
        // Opens inside the pane. Next to it may lie the view of a web account, which would cover it.
        <Menu positioning={{ position: 'below', align: 'end' }}>
          <MenuTrigger disableButtonEnhancement>
            <Button
              appearance="subtle"
              size="small"
              icon={<MoreHorizontalRegular />}
              aria-label={t('folders.accountMenu')}
            />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {account.provider === 'web' && (
                <MenuItem
                  icon={<ArrowClockwiseRegular />}
                  onClick={() => window.outlo.web.reload(account.id)}
                >
                  {t('web.reload')}
                </MenuItem>
              )}
              {account.provider === 'web' && props.onFullSignIn && (
                <MenuItem icon={<PersonKeyRegular />} onClick={() => props.onFullSignIn?.(account)}>
                  {t('folders.fullSignIn')}
                </MenuItem>
              )}
              <MenuItem icon={<DeleteRegular />} onClick={() => onRemoveAccount(account)}>
                {t('folders.removeAccount')}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      )}
    </div>
  );

  // Says what keeps an account from being up to date. Nothing is shown while all is well.
  const syncProblem = (account: Account) => {
    const status = stateOf(account);
    if (!status || status.state === 'idle' || status.state === 'syncing') return null;
    if (status.state === 'offline') return <div className={styles.status}>{t('sync.offline')}</div>;
    return (
      <div className={mergeClasses(styles.status, styles.problem)}>
        {status.state === 'signInNeeded' && t('sync.signInNeeded')}
        {status.state === 'noMailbox' && t('sync.noMailbox')}
        {status.state === 'error' && `${t('sync.error')} ${status.message ?? ''}`}
        {status.state === 'signInNeeded' && onAddAccount && (
          <button type="button" className={styles.link} onClick={onAddAccount}>
            {t('sync.signIn')}
          </button>
        )}
      </div>
    );
  };

  const folderRow = (folder: Folder, depth: number, label = folder.name, key = `f${folder.id}`) => {
    // Drafts and junk show how many messages they hold, the others how many are unread.
    const showsTotal = folder.role === 'drafts' || folder.role === 'junk';
    const count = showsTotal ? folder.totalCount : folder.unreadCount;
    return (
      <button
        key={key}
        type="button"
        className={mergeClasses(styles.row, folder.id === selectedFolderId && styles.selected)}
        style={{ paddingLeft: 28 + depth * 16 }}
        aria-current={folder.id === selectedFolderId}
        onClick={() => onSelect(folder.id)}
      >
        <span className={styles.icon}>
          {folder.role ? ROLE_ICONS[folder.role] : <FolderRegular />}
        </span>
        <span className={styles.name}>{label}</span>
        {count > 0 && (
          <span className={mergeClasses(styles.count, !showsTotal && styles.unread)}>
            {showsTotal ? `[${count}]` : count}
          </span>
        )}
      </button>
    );
  };

  const tree = (accountId: number, parentId: number | null, depth: number): ReactElement[] =>
    children(parentId, accountId).flatMap((folder) => [
      folderRow(folder, depth),
      ...tree(accountId, folder.id, depth + 1),
    ]);

  const favorites = mailboxes.folders.filter((folder) => folder.isFavorite);
  return (
    <nav className={styles.root}>
      {favorites.length > 0 && (
        <>
          {section('favorites', t('folders.favorites'))}
          {!collapsed.has('favorites') &&
            favorites.map((folder) =>
              folderRow(
                folder,
                0,
                `${folder.name} (${accountEmail(folder.accountId)})`,
                `favorite${folder.id}`,
              ),
            )}
          <div className={styles.divider} />
        </>
      )}
      {mailboxes.accounts.map((account) => (
        <div key={account.id}>
          {section(`account${account.id}`, account.email, account)}
          {syncProblem(account)}
          {!collapsed.has(`account${account.id}`) &&
            (account.provider === 'web' ? (
              <button
                type="button"
                className={mergeClasses(
                  styles.row,
                  account.id === props.selectedWebAccountId && styles.selected,
                )}
                style={{ paddingLeft: 28 }}
                aria-current={account.id === props.selectedWebAccountId}
                onClick={() => props.onSelectWeb(account.id)}
              >
                <span className={styles.icon}>
                  <GlobeRegular />
                </span>
                <span className={styles.name}>{t('folders.webEntry')}</span>
              </button>
            ) : children(null, account.id).length > 0 ? (
              tree(account.id, null, 0)
            ) : (
              <div className={styles.none}>{t('folders.none')}</div>
            ))}
        </div>
      ))}
      <div className={styles.divider} />
      <button
        type="button"
        className={styles.row}
        style={{ paddingLeft: 8 }}
        disabled={!onAddAccount}
        onClick={onAddAccount}
      >
        <span className={styles.icon}>
          <PersonAddRegular />
        </span>
        <span className={styles.name}>{t('folders.addAccount')}</span>
      </button>
    </nav>
  );
}
