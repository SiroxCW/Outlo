import { Input, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { SearchRegular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { TITLE_BAR_HEIGHT } from '@shared/api';
import iconUrl from '../../../../resources/icon.svg';
import { t } from '../i18n';
import { barBackground } from '../theme';

const useStyles = makeStyles({
  root: {
    height: `${TITLE_BAR_HEIGHT}px`,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
  },
  // Electron draws the window buttons over the right end of the bar and reports the free area.
  customFrame: {
    paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))',
  },
  brand: {
    width: '264px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    paddingLeft: '12px',
    boxSizing: 'border-box',
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  icon: { width: '24px', height: '24px' },
  search: { width: '352px', maxWidth: '40vw' },
  end: { marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: '8px' },
});

interface TitleBarProps {
  customFrame: boolean;
  dark: boolean;
  // False while an account in web mode is open. Outlook on the web has a search box of its own,
  // and this one does not search it.
  showSearch: boolean;
  search: string;
  onSearch(query: string): void;
  // Buttons at the right end of the bar.
  children?: ReactNode;
}

export function TitleBar(props: TitleBarProps) {
  const { customFrame, dark, search, onSearch } = props;
  const styles = useStyles();
  return (
    <header
      className={mergeClasses(
        styles.root,
        customFrame && styles.customFrame,
        customFrame && 'window-drag',
      )}
      style={{ backgroundColor: barBackground(dark) }}
    >
      <div className={styles.brand}>
        <img className={styles.icon} src={iconUrl} alt="" />
        {t('app.name')}
      </div>
      {props.showSearch && (
        <Input
          className={mergeClasses(styles.search, 'window-no-drag')}
          contentBefore={<SearchRegular />}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          value={search}
          onChange={(_event, data) => onSearch(data.value)}
          onKeyDown={(event) => event.key === 'Escape' && onSearch('')}
        />
      )}
      <div className={mergeClasses(styles.end, 'window-no-drag')}>{props.children}</div>
    </header>
  );
}
