import {
  Button,
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemCheckbox,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
} from '@fluentui/react-components';
import {
  BeakerRegular,
  ChatMultipleRegular,
  DocumentTextRegular,
  SettingsRegular,
  WindowRegular,
} from '@fluentui/react-icons';
import type { TitleBarStyle } from '@shared/api';
import { t } from '../i18n';
import { THEME_CHOICES, THEME_LABELS, type ThemeChoice } from '../theme';

interface SettingsMenuProps {
  theme: ThemeChoice;
  onTheme(theme: ThemeChoice): void;
  titleBar: TitleBarStyle;
  onTitleBar(style: TitleBarStyle): void;
  demo: boolean;
  onDemo(demo: boolean): void;
  conversations: boolean;
  onConversations(on: boolean): void;
  // The menu opens over the place of a web account, which has to step aside meanwhile.
  onOpenChange(open: boolean): void;
}

// The settings of the View tab, also reachable while an account in web mode hides the ribbon.
export function SettingsMenu(props: SettingsMenuProps) {
  const checked = {
    theme: [props.theme],
    window: props.titleBar === 'native' ? ['native'] : [],
    session: props.demo ? ['demo'] : [],
    list: props.conversations ? ['conversations'] : [],
  };
  return (
    <Menu
      checkedValues={checked}
      onCheckedValueChange={(_event, { name, checkedItems }) => {
        const on = checkedItems.length > 0;
        if (name === 'theme') props.onTheme(checkedItems[0] as ThemeChoice);
        if (name === 'window') props.onTitleBar(on ? 'native' : 'custom');
        if (name === 'session') props.onDemo(on);
        if (name === 'list') props.onConversations(on);
      }}
      onOpenChange={(_event, data) => props.onOpenChange(data.open)}
      positioning={{ position: 'below', align: 'end' }}
    >
      <MenuTrigger disableButtonEnhancement>
        {/* Beside the button, inside the title bar: below it the page of a web account may lie. */}
        <Tooltip content={t('settings.title')} relationship="label" positioning="before">
          <Button appearance="subtle" icon={<SettingsRegular />} />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuGroup>
            <MenuGroupHeader>{t('ribbon.theme')}</MenuGroupHeader>
            {THEME_CHOICES.map((choice) => (
              <MenuItemRadio key={choice} name="theme" value={choice}>
                {t(THEME_LABELS[choice])}
              </MenuItemRadio>
            ))}
          </MenuGroup>
          <MenuDivider />
          <MenuItemCheckbox name="list" value="conversations" icon={<ChatMultipleRegular />}>
            {t('ribbon.conversations')}
          </MenuItemCheckbox>
          <MenuItemCheckbox name="window" value="native" icon={<WindowRegular />}>
            {t('ribbon.systemTitleBar')}
          </MenuItemCheckbox>
          <MenuItemCheckbox name="session" value="demo" icon={<BeakerRegular />}>
            {t('ribbon.demo')}
          </MenuItemCheckbox>
          <MenuDivider />
          {/* For bug reports. The log holds no addresses, names or texts of mail. */}
          <MenuItem icon={<DocumentTextRegular />} onClick={() => window.outlo.logs.openFolder()}>
            {t('settings.openLogs')}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
