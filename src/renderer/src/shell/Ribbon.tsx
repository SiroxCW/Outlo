import {
  Button,
  Divider,
  makeStyles,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tab,
  TabList,
  ToggleButton,
  tokens,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArchiveRegular,
  ArrowForwardRegular,
  ArrowReplyAllRegular,
  ArrowReplyRegular,
  ArrowUndoRegular,
  ChatMultipleRegular,
  ClockRegular,
  ComposeRegular,
  DeleteRegular,
  FlagFilled,
  FlagRegular,
  FolderArrowRightRegular,
  MailReadRegular,
  MailUnreadRegular,
  NavigationRegular,
  PinRegular,
  PrintRegular,
  ShieldCheckmarkRegular,
  ShieldErrorRegular,
  TagRegular,
  BeakerRegular,
  WindowRegular,
} from '@fluentui/react-icons';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import type { Folder, Message, ResponseKind, TitleBarStyle } from '@shared/api';
import { t } from '../i18n';
import { THEME_CHOICES, THEME_LABELS, type ThemeChoice } from '../theme';

const useStyles = makeStyles({
  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    height: '36px',
    paddingLeft: '8px',
  },
  ribbon: {
    display: 'flex',
    alignItems: 'stretch',
    height: '92px',
    margin: '0 8px',
    padding: '6px 4px 2px',
    boxSizing: 'border-box',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  group: { display: 'flex', flexDirection: 'column', padding: '0 4px' },
  groupButtons: { flexGrow: 1, display: 'flex', alignItems: 'flex-start', gap: '2px' },
  groupLabel: {
    textAlign: 'center',
    fontSize: tokens.fontSizeBase100,
    lineHeight: '16px',
    color: tokens.colorNeutralForeground3,
  },
  column: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
  large: {
    flexDirection: 'column',
    gap: '2px',
    minWidth: '52px',
    height: '64px',
    padding: '4px 6px',
    fontWeight: tokens.fontWeightRegular,
    fontSize: tokens.fontSizeBase200,
    lineHeight: '14px',
    whiteSpace: 'pre-line',
    '& .fui-Button__icon': { fontSize: '28px', width: '28px', height: '28px', marginRight: 0 },
  },
  small: {
    minWidth: 0,
    height: '21px',
    padding: '0 6px',
    fontWeight: tokens.fontWeightRegular,
    fontSize: tokens.fontSizeBase200,
    justifyContent: 'flex-start',
    '& .fui-Button__icon': { fontSize: '16px', width: '16px', height: '16px' },
  },
  folderMenu: { maxHeight: '60vh', overflowX: 'hidden', overflowY: 'auto' },
});

interface RibbonProps {
  message: Message | null | undefined;
  theme: ThemeChoice;
  titleBar: TitleBarStyle;
  onToggleFolders(): void;
  onSetRead(isRead: boolean): void;
  onSetFlagged(isFlagged: boolean): void;
  // Undefined where no account can write mail.
  onNewMail: (() => void) | undefined;
  // Undefined or false where the action does not apply to the open message.
  onRespond: ((kind: ResponseKind) => void) | undefined;
  onDelete: (() => void) | undefined;
  onArchive: (() => void) | undefined;
  junk: { notJunk: boolean; onClick(): void } | false | undefined;
  // The folders of the open message's account, as places to move it to.
  folders: Folder[];
  onMove(folderId: number): void;
  onTheme(theme: ThemeChoice): void;
  onTitleBar(style: TitleBarStyle): void;
  demo: boolean;
  onDemo(demo: boolean): void;
  conversations: boolean;
  onConversations(on: boolean): void;
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <>
      <div className={styles.group}>
        <div className={styles.groupButtons}>{children}</div>
        <div className={styles.groupLabel}>{label}</div>
      </div>
      <Divider vertical />
    </>
  );
}

interface ActionProps {
  label: string;
  icon: ReactElement;
  // Features of later phases are shown, but cannot be used yet.
  onClick?: () => void;
}

// The folders a message can be moved to, in the order of the folder pane, with their depth.
function moveTargets(folders: Folder[], currentId: number | undefined) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const depth = (folder: Folder) => {
    let level = 0;
    for (let parent = folder.parentId; parent !== null && level < 20; level++) {
      parent = byId.get(parent)?.parentId ?? null;
    }
    return level;
  };
  // The outbox holds what is being sent. Nothing is moved there by hand.
  return folders
    .filter((folder) => folder.id !== currentId && folder.role !== 'outbox')
    .map((folder) => ({ folder, depth: depth(folder) }));
}

function MoveMenu({
  folders,
  currentId,
  onMove,
}: {
  folders: Folder[];
  currentId: number | undefined;
  onMove(folderId: number): void;
}) {
  const styles = useStyles();
  const targets = useMemo(() => moveTargets(folders, currentId), [folders, currentId]);
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button
          className={styles.large}
          appearance="subtle"
          icon={<FolderArrowRightRegular />}
          disabled={targets.length === 0}
        >
          {t('ribbon.move')}
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList className={styles.folderMenu}>
          {targets.map(({ folder, depth }) => (
            <MenuItem
              key={folder.id}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
              onClick={() => onMove(folder.id)}
            >
              {folder.name}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

function Large({ label, icon, onClick }: ActionProps) {
  const styles = useStyles();
  return (
    <Button
      className={styles.large}
      appearance="subtle"
      icon={icon}
      disabled={!onClick}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function Small({ label, icon, onClick }: ActionProps) {
  const styles = useStyles();
  return (
    <Button
      className={styles.small}
      appearance="subtle"
      icon={icon}
      disabled={!onClick}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function Ribbon(props: RibbonProps) {
  const styles = useStyles();
  const [tab, setTab] = useState<'home' | 'view'>('home');
  const { message } = props;
  const withMessage = (action: () => void) => (message ? action : undefined);
  const respond = props.onRespond;

  return (
    <div>
      <div className={styles.tabs}>
        <Tooltip content={t('ribbon.toggleFolders')} relationship="label">
          <Button
            appearance="subtle"
            icon={<NavigationRegular />}
            onClick={props.onToggleFolders}
          />
        </Tooltip>
        <TabList
          size="small"
          selectedValue={tab}
          onTabSelect={(_event, data) => setTab(data.value as 'home' | 'view')}
        >
          <Tab value="home">{t('tab.home')}</Tab>
          <Tab value="view">{t('tab.view')}</Tab>
        </TabList>
      </div>

      {tab === 'home' && (
        <div className={styles.ribbon}>
          <Group label={t('ribbon.new')}>
            <Large
              label={t('ribbon.newMail')}
              icon={<ComposeRegular />}
              onClick={props.onNewMail}
            />
          </Group>
          <Group label={t('ribbon.delete')}>
            <Large label={t('ribbon.delete')} icon={<DeleteRegular />} onClick={props.onDelete} />
            <Large
              label={t('ribbon.archive')}
              icon={<ArchiveRegular />}
              onClick={props.onArchive}
            />
            {props.junk && props.junk.notJunk ? (
              <Large
                label={t('ribbon.notJunk')}
                icon={<ShieldCheckmarkRegular />}
                onClick={props.junk.onClick}
              />
            ) : (
              <Large
                label={t('ribbon.junk')}
                icon={<ShieldErrorRegular />}
                onClick={props.junk ? props.junk.onClick : undefined}
              />
            )}
          </Group>
          <Group label={t('ribbon.respond')}>
            <div className={styles.column}>
              <Small
                label={t('ribbon.reply')}
                icon={<ArrowReplyRegular />}
                onClick={respond && (() => respond('reply'))}
              />
              <Small
                label={t('ribbon.replyAll')}
                icon={<ArrowReplyAllRegular />}
                onClick={respond && (() => respond('replyAll'))}
              />
              <Small
                label={t('ribbon.forward')}
                icon={<ArrowForwardRegular />}
                onClick={respond && (() => respond('forward'))}
              />
            </div>
          </Group>
          <Group label={t('ribbon.move')}>
            <MoveMenu folders={props.folders} currentId={message?.folderId} onMove={props.onMove} />
          </Group>
          <Group label={t('ribbon.tags')}>
            <Large
              label={t('ribbon.readUnread').replace(' / ', ' /\n')}
              icon={message?.isRead ? <MailUnreadRegular /> : <MailReadRegular />}
              onClick={withMessage(() => props.onSetRead(!message!.isRead))}
            />
            <div className={styles.column}>
              <Small label={t('ribbon.categorize')} icon={<TagRegular />} />
              <Small
                label={t('ribbon.flag')}
                icon={message?.isFlagged ? <FlagFilled /> : <FlagRegular />}
                onClick={withMessage(() => props.onSetFlagged(!message!.isFlagged))}
              />
              <Small label={t('ribbon.pin')} icon={<PinRegular />} />
            </div>
            <Large label={t('ribbon.snooze')} icon={<ClockRegular />} />
          </Group>
          <Group label={t('ribbon.print')}>
            <Large label={t('ribbon.print')} icon={<PrintRegular />} />
          </Group>
          <Group label={t('ribbon.undo')}>
            <Large label={t('ribbon.undo')} icon={<ArrowUndoRegular />} />
          </Group>
        </div>
      )}

      {tab === 'view' && (
        <div className={styles.ribbon}>
          <Group label={t('ribbon.layout')}>
            <ToggleButton
              size="small"
              appearance="subtle"
              icon={<ChatMultipleRegular />}
              checked={props.conversations}
              onClick={() => props.onConversations(!props.conversations)}
            >
              {t('ribbon.conversations')}
            </ToggleButton>
          </Group>
          <Group label={t('ribbon.theme')}>
            {THEME_CHOICES.map((choice) => (
              <ToggleButton
                key={choice}
                size="small"
                appearance="subtle"
                checked={props.theme === choice}
                onClick={() => props.onTheme(choice)}
              >
                {t(THEME_LABELS[choice])}
              </ToggleButton>
            ))}
          </Group>
          <Group label={t('ribbon.window')}>
            <ToggleButton
              size="small"
              appearance="subtle"
              icon={<WindowRegular />}
              checked={props.titleBar === 'native'}
              onClick={() => props.onTitleBar(props.titleBar === 'native' ? 'custom' : 'native')}
            >
              {t('ribbon.systemTitleBar')}
            </ToggleButton>
          </Group>
          <Group label={t('ribbon.session')}>
            <ToggleButton
              size="small"
              appearance="subtle"
              icon={<BeakerRegular />}
              checked={props.demo}
              onClick={() => props.onDemo(!props.demo)}
            >
              {t('ribbon.demo')}
            </ToggleButton>
          </Group>
        </div>
      )}
    </div>
  );
}
