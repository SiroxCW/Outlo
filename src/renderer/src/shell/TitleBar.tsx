import { Input, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { SearchRegular } from '@fluentui/react-icons';
import { TITLE_BAR_HEIGHT } from '@shared/api';
import iconUrl from '../../../../resources/icon.svg';
import { t } from '../i18n';

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
});

interface TitleBarProps {
  customFrame: boolean;
  search: string;
  onSearch(query: string): void;
}

export function TitleBar({ customFrame, search, onSearch }: TitleBarProps) {
  const styles = useStyles();
  return (
    <header
      className={mergeClasses(
        styles.root,
        customFrame && styles.customFrame,
        customFrame && 'window-drag',
      )}
    >
      <div className={styles.brand}>
        <img className={styles.icon} src={iconUrl} alt="" />
        {t('app.name')}
      </div>
      <Input
        className={mergeClasses(styles.search, 'window-no-drag')}
        contentBefore={<SearchRegular />}
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        value={search}
        onChange={(_event, data) => onSearch(data.value)}
        onKeyDown={(event) => event.key === 'Escape' && onSearch('')}
      />
    </header>
  );
}
