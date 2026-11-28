import { makeStyles, mergeClasses, tokens, Tooltip } from '@fluentui/react-components';
import {
  CalendarFilled,
  CalendarRegular,
  MailFilled,
  MailRegular,
  PeopleFilled,
  PeopleRegular,
} from '@fluentui/react-icons';
import type { ReactElement } from 'react';
import type { WebModule } from '@shared/api';
import { t } from '../i18n';
import { barBackground } from '../theme';

const useStyles = makeStyles({
  root: {
    width: '48px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    paddingTop: '4px',
  },
  button: {
    position: 'relative',
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground2,
    fontSize: '24px',
    ':hover:enabled': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':disabled': { color: tokens.colorNeutralForegroundDisabled },
  },
  selected: {
    color: tokens.colorBrandForeground1,
    '::before': {
      content: '""',
      position: 'absolute',
      left: '-4px',
      top: '10px',
      bottom: '10px',
      width: '3px',
      borderRadius: '2px',
      backgroundColor: tokens.colorBrandForeground1,
    },
  },
});

function Module(props: {
  label: string;
  icon: ReactElement;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const styles = useStyles();
  return (
    <Tooltip content={props.label} relationship="label" positioning="after">
      <button
        type="button"
        className={mergeClasses(styles.button, props.selected && styles.selected)}
        aria-pressed={props.selected === true}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.icon}
      </button>
    </Tooltip>
  );
}

interface AppBarProps {
  dark: boolean;
  // Set while an account in web mode is open. The bar then stands in for the one of Outlook on
  // the web and switches between its modules.
  web?: { module: WebModule; onOpen(module: WebModule): void };
}

// The strip on the left that switches between the modules. Calendar and People of the app
// itself come later.
export function AppBar({ dark, web }: AppBarProps) {
  const styles = useStyles();
  const module = web?.module ?? 'mail';
  const open = (target: WebModule) => (web ? () => web.onOpen(target) : undefined);
  return (
    <nav className={styles.root} style={{ backgroundColor: barBackground(dark) }}>
      <Module
        label={t('module.mail')}
        icon={module === 'mail' ? <MailFilled /> : <MailRegular />}
        selected={module === 'mail'}
        onClick={open('mail')}
      />
      <Module
        label={t('module.calendar')}
        icon={module === 'calendar' ? <CalendarFilled /> : <CalendarRegular />}
        selected={module === 'calendar'}
        disabled={!web}
        onClick={open('calendar')}
      />
      <Module
        label={t('module.people')}
        icon={module === 'people' ? <PeopleFilled /> : <PeopleRegular />}
        selected={module === 'people'}
        disabled={!web}
        onClick={open('people')}
      />
    </nav>
  );
}
