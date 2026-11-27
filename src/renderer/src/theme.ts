import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components';

// Segoe UI where the user has it installed, the bundled Selawik everywhere else.
const fontFamilyBase = "'Segoe UI', 'Selawik', system-ui, sans-serif";

export const lightTheme: Theme = { ...webLightTheme, fontFamilyBase };
export const darkTheme: Theme = { ...webDarkTheme, fontFamilyBase };

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
