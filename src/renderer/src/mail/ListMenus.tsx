import {
  Button,
  makeStyles,
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  tokens,
  Tooltip,
} from '@fluentui/react-components';
import { ArrowSortRegular, FilterFilled, FilterRegular } from '@fluentui/react-icons';
import type { ListFilter, MessageSort, SortField } from '@shared/api';
import { t } from '../i18n';
import { FILTER_LABELS, LIST_FILTERS, ORDERS, SORT_FIELDS, SORT_LABELS, sortBy } from './sorting';

const useStyles = makeStyles({
  root: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '2px' },
  active: { color: tokens.colorBrandForeground1 },
});

interface ListMenusProps {
  show: ListFilter;
  sort: MessageSort;
  onShow(show: ListFilter): void;
  onSort(sort: MessageSort): void;
}

// The Filter and Sort buttons at the top of the message list.
export function ListMenus({ show, sort, onShow, onSort }: ListMenusProps) {
  const styles = useStyles();
  const filtered = show !== 'all';
  const order = sort.descending ? 'descending' : 'ascending';

  return (
    <div className={styles.root}>
      <Menu
        checkedValues={{ show: [show] }}
        onCheckedValueChange={(_event, data) => onShow(data.checkedItems[0] as ListFilter)}
        positioning={{ position: 'below', align: 'end' }}
      >
        <MenuTrigger disableButtonEnhancement>
          {/* With a filter on, the button names it, and the tooltip only describes the button. */}
          <Tooltip content={t('list.filter')} relationship={filtered ? 'description' : 'label'}>
            <Button
              appearance="subtle"
              size="small"
              className={filtered ? styles.active : undefined}
              icon={filtered ? <FilterFilled /> : <FilterRegular />}
            >
              {filtered ? t(FILTER_LABELS[show]) : undefined}
            </Button>
          </Tooltip>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {LIST_FILTERS.map((value) => (
              <MenuItemRadio key={value} name="show" value={value}>
                {t(FILTER_LABELS[value])}
              </MenuItemRadio>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>

      <Menu
        checkedValues={{ field: [sort.field], order: [order] }}
        onCheckedValueChange={(_event, { name, checkedItems }) => {
          const value = checkedItems[0];
          if (name === 'field') onSort(sortBy(value as SortField));
          if (name === 'order') onSort({ field: sort.field, descending: value === 'descending' });
        }}
        positioning={{ position: 'below', align: 'end' }}
      >
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content={t('list.sort')} relationship="label">
            <Button appearance="subtle" size="small" icon={<ArrowSortRegular />} />
          </Tooltip>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuGroup>
              <MenuGroupHeader>{t('sort.by')}</MenuGroupHeader>
              {SORT_FIELDS.map((field) => (
                <MenuItemRadio key={field} name="field" value={field}>
                  {t(SORT_LABELS[field])}
                </MenuItemRadio>
              ))}
            </MenuGroup>
            <MenuDivider />
            <MenuGroup>
              <MenuGroupHeader>{t('sort.order')}</MenuGroupHeader>
              {ORDERS[sort.field].map(([value, label]) => (
                <MenuItemRadio key={value} name="order" value={value}>
                  {t(label)}
                </MenuItemRadio>
              ))}
            </MenuGroup>
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
}
