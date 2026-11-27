import { Button, makeStyles, tokens } from '@fluentui/react-components';
import { PersonAddRegular } from '@fluentui/react-icons';
import icon from '../../../../resources/icon.svg';
import { t } from '../i18n';

const useStyles = makeStyles({
  root: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalL,
    marginLeft: '8px',
    padding: '24px',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    textAlign: 'center',
  },
  icon: { width: '72px', height: '72px' },
  title: { margin: 0, fontSize: tokens.fontSizeHero700, fontWeight: tokens.fontWeightSemibold },
  text: { margin: 0, maxWidth: '28em' },
  demo: {
    marginTop: tokens.spacingVerticalXXL,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

// Shown as long as the app has no account.
export function Welcome({ onAddAccount, onDemo }: { onAddAccount(): void; onDemo(): void }) {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      <img className={styles.icon} src={icon} alt="" />
      <h1 className={styles.title}>{t('welcome.title')}</h1>
      <p className={styles.text}>{t('welcome.text')}</p>
      <Button appearance="primary" size="large" icon={<PersonAddRegular />} onClick={onAddAccount}>
        {t('folders.addAccount')}
      </Button>
      <div className={styles.demo}>
        {t('welcome.demoHint')}
        <Button onClick={onDemo}>{t('welcome.demo')}</Button>
      </div>
    </div>
  );
}
