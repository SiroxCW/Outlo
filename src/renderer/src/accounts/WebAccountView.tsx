import { Button, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowClockwiseRegular, GlobeRegular } from '@fluentui/react-icons';
import { useEffect, useRef } from 'react';
import type { Account } from '@shared/api';
import { t } from '../i18n';

const useStyles = makeStyles({
  root: {
    flexGrow: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  bar: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 8px 4px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  icon: { fontSize: '16px', flexShrink: 0 },
  text: { flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  place: {
    flexGrow: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForeground3,
  },
});

interface WebAccountViewProps {
  account: Account;
  // True while a dialog of the app is open. The web view lies on top of the page, so it has to
  // step aside or it would cover the dialog.
  covered: boolean;
}

// Shown for an account in web mode. The page itself is not part of this UI: the main process
// lays a separate, isolated view over the place this component keeps free and reports.
export function WebAccountView({ account, covered }: WebAccountViewProps) {
  const styles = useStyles();
  const place = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = place.current;
    if (!element || covered) return;
    const report = () => {
      const { x, y, width, height } = element.getBoundingClientRect();
      window.outlo.web.show(account.id, { x, y, width, height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      window.outlo.web.hide();
    };
  }, [account.id, covered]);

  return (
    <section className={styles.root}>
      <div className={styles.bar}>
        <GlobeRegular className={styles.icon} />
        <span className={styles.text} title={t('web.info')}>
          {t('web.info')}
        </span>
        <Button
          appearance="subtle"
          size="small"
          icon={<ArrowClockwiseRegular />}
          onClick={() => window.outlo.web.reload(account.id)}
        >
          {t('web.reload')}
        </Button>
      </div>
      <div ref={place} className={styles.place}>
        {t('web.loading')}
      </div>
    </section>
  );
}
