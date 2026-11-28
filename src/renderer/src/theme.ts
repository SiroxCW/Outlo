import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components';
import type { ThemeChoice } from '@shared/api';

// Segoe UI where the user has it installed, the bundled Selawik everywhere else.
const fontFamilyBase = "'Segoe UI', 'Selawik', system-ui, sans-serif";

export const lightTheme: Theme = { ...webLightTheme, fontFamilyBase };
export const darkTheme: Theme = { ...webDarkTheme, fontFamilyBase };

// Dark mode steps twice as fast between neutrals as light mode, so each theme picks the shade
// that reads clearly darker than the shell without going pure black.
export const barBackground = (dark: boolean): string =>
  dark ? darkTheme.colorNeutralBackground4 : lightTheme.colorNeutralBackground5;

export type { ThemeChoice };
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
export const THEME_LABELS = {
  system: 'ribbon.themeSystem',
  light: 'ribbon.themeLight',
  dark: 'ribbon.themeDark',
} as const;
