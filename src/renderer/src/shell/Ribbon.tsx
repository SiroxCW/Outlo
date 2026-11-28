import {
  Button,
  Divider,
  makeStyles,
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
  TagRegular,
  BeakerRegular,
  WindowRegular,
} from '@fluentui/react-icons';
import { useState, type ReactElement, type ReactNode } from 'react';
import type { Message, TitleBarStyle } from '@shared/api';
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
});

interface RibbonProps {
  message: Message | null | undefined;
  theme: ThemeChoice;
  titleBar: TitleBarStyle;
  onToggleFolders(): void;
  onSetRead(isRead: boolean): void;
  onSetFlagged(isFlagged: boolean): void;
  onTheme(theme: ThemeChoice): void;
  onTitleBar(style: TitleBarStyle): void;
  demo: boolean;
  onDemo(demo: boolean): void;
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
            <Large label={t('ribbon.newMail')} icon={<ComposeRegular />} />
          </Group>
          <Group label={t('ribbon.delete')}>
            <Large label={t('ribbon.delete')} icon={<DeleteRegular />} />
            <Large label={t('ribbon.archive')} icon={<ArchiveRegular />} />
          </Group>
          <Group label={t('ribbon.respond')}>
            <div className={styles.column}>
              <Small label={t('ribbon.reply')} icon={<ArrowReplyRegular />} />
              <Small label={t('ribbon.replyAll')} icon={<ArrowReplyAllRegular />} />
              <Small label={t('ribbon.forward')} icon={<ArrowForwardRegular />} />
            </div>
          </Group>
          <Group label={t('ribbon.move')}>
            <Large label={t('ribbon.move')} icon={<FolderArrowRightRegular />} />
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
