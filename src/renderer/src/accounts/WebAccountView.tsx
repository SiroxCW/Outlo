import {
  Button,
  makeStyles,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  tokens,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useEffect, useRef, useState } from 'react';
import type { Account } from '@shared/api';
import { t } from '../i18n';

const useStyles = makeStyles({
  root: { flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' },
  card: {
    flexGrow: 1,
    minHeight: 0,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
    color: tokens.colorNeutralForeground3,
  },
  snapshot: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  tip: { flexShrink: 0 },
});

interface WebAccountViewProps {
  account: Account;
  // True while a dialog or menu of the app lies over the page. The web view is drawn on top of
  // the whole UI, so it has to step aside or it would cover them.
  covered: boolean;
  // A one-time hint how Outlook on the web follows the dark mode of the app.
  themeTip: boolean;
  onThemeTipDone(): void;
}

// Shown for an account in web mode. The page itself is not part of this UI: the main process
// lays a separate, isolated view over the place this component keeps free and reports.
export function WebAccountView({
  account,
  covered,
  themeTip,
  onThemeTipDone,
}: WebAccountViewProps) {
  const styles = useStyles();
  const place = useRef<HTMLDivElement>(null);
  // While the page steps aside, a still picture of it keeps the place from going blank. It
  // stays in place under the page afterwards, where nobody sees it, until the next one.
  const [snapshot, setSnapshot] = useState<{ picture: string; number: number }>();
  const taken = useRef(0);

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
    };
  }, [account.id, covered]);

  // The picture is taken first and the page hidden once it is drawn. Without a picture, for
  // example before anything has loaded, the page is hidden right away.
  useEffect(() => {
    if (!covered) return;
    let current = true;
    void window.outlo.web.snapshot(account.id).then((picture) => {
      if (!current) return;
      taken.current += 1;
      setSnapshot(picture ? { picture, number: taken.current } : undefined);
      if (!picture) window.outlo.web.hide();
    });
    return () => {
      current = false;
    };
  }, [account.id, covered]);

  useEffect(() => () => window.outlo.web.hide(), []);

  return (
    <section className={styles.root}>
      {themeTip && (
        <MessageBar className={styles.tip}>
          <MessageBarBody>{t('web.themeTip')}</MessageBarBody>
          <MessageBarActions
            containerAction={
              <Button
                appearance="transparent"
                size="small"
                icon={<DismissRegular />}
                aria-label={t('action.close')}
                onClick={onThemeTipDone}
              />
            }
          >
            <Button
              size="small"
              onClick={() => {
                window.outlo.web.open(account.id, 'settings');
                onThemeTipDone();
              }}
            >
              {t('web.openSettings')}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}
      <div ref={place} className={styles.card}>
        {t('web.loading')}
        {snapshot && (
          // A new element for each picture, so it reports being drawn even when the page has
          // not changed and the picture is the same.
          <img
            key={snapshot.number}
            className={styles.snapshot}
            src={snapshot.picture}
            alt=""
            onLoad={() => covered && window.outlo.web.hide()}
          />
        )}
      </div>
    </section>
  );
}
