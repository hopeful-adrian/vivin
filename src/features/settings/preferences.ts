import type { DocumentTheme } from '../../lib/editor-theme';
import type { Locale } from '../../lib/i18n';

export type Appearance = 'light' | 'dark' | 'system';
export type NewPaneMode = 'same' | 'source' | 'rendered';

export interface Preferences {
  locale: Locale;
  appearance: Appearance;
  documentTheme: DocumentTheme;
  autoFormat: boolean;
  sidebarWidth: number;
  editorScale: number;
  newPaneMode: NewPaneMode;
  checkUpdates: boolean;
}

export const defaultPreferences: Preferences = {
  locale: 'zh',
  appearance: 'light',
  documentTheme: 'frame',
  autoFormat: true,
  sidebarWidth: 256,
  editorScale: 1,
  newPaneMode: 'same',
  checkUpdates: true,
};

export const editorScales = [0.9, 1, 1.1, 1.2, 1.3] as const;

/** Storage keys predate this module and stay stable so existing settings survive upgrades. */
export const preferenceKeys: Record<keyof Preferences, string> = {
  locale: 'vivin.locale',
  appearance: 'vivin.theme',
  documentTheme: 'vivin.document-theme',
  autoFormat: 'vivin.auto-format',
  sidebarWidth: 'vivin.sidebar-width',
  editorScale: 'vivin.editor-scale',
  newPaneMode: 'vivin.new-pane-mode',
  checkUpdates: 'vivin.check-updates',
};

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** Validates each stored value independently; unknown or corrupt values fall back to defaults. */
export function parsePreferences(read: (key: string) => unknown): Preferences {
  const width = read(preferenceKeys.sidebarWidth);
  const scale = read(preferenceKeys.editorScale);
  return {
    locale: oneOf(read(preferenceKeys.locale), ['zh', 'en'], defaultPreferences.locale),
    appearance: oneOf(
      read(preferenceKeys.appearance),
      ['light', 'dark', 'system'],
      defaultPreferences.appearance,
    ),
    documentTheme: oneOf(
      read(preferenceKeys.documentTheme),
      ['frame', 'classic', 'nord'],
      defaultPreferences.documentTheme,
    ),
    autoFormat: read(preferenceKeys.autoFormat) !== false,
    sidebarWidth:
      typeof width === 'number' && Number.isFinite(width)
        ? Math.round(width)
        : defaultPreferences.sidebarWidth,
    editorScale: editorScales.includes(scale as (typeof editorScales)[number])
      ? (scale as number)
      : defaultPreferences.editorScale,
    newPaneMode: oneOf(
      read(preferenceKeys.newPaneMode),
      ['same', 'source', 'rendered'],
      defaultPreferences.newPaneMode,
    ),
    checkUpdates: read(preferenceKeys.checkUpdates) !== false,
  };
}

export function readStoredJson(storage: Pick<Storage, 'getItem'>, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
