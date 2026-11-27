import { makeStyles, mergeClasses, tokens, Tooltip } from '@fluentui/react-components';
import { CalendarRegular, MailFilled, PeopleRegular } from '@fluentui/react-icons';
import type { ReactElement } from 'react';
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
}) {
  const styles = useStyles();
  return (
    <Tooltip content={props.label} relationship="label" positioning="after">
      <button
        type="button"
        className={mergeClasses(styles.button, props.selected && styles.selected)}
        aria-pressed={props.selected === true}
        disabled={props.disabled}
      >
        {props.icon}
      </button>
    </Tooltip>
  );
}

// The strip on the left that switches between the modules. Calendar and People come later.
export function AppBar({ dark }: { dark: boolean }) {
  const styles = useStyles();
  return (
    <nav className={styles.root} style={{ backgroundColor: barBackground(dark) }}>
      <Module label={t('module.mail')} icon={<MailFilled />} selected />
      <Module label={t('module.calendar')} icon={<CalendarRegular />} disabled />
      <Module label={t('module.people')} icon={<PeopleRegular />} disabled />
    </nav>
  );
}
