import type { DocumentTheme } from '../../lib/editor-theme';
import type { Locale } from '../../lib/i18n';
import type { AnnotationKind } from '../../lib/project-api';

export type Appearance = 'light' | 'dark' | 'system';
export type NewPaneMode = 'same' | 'source' | 'rendered';
export type LineHeight = 'compact' | 'standard' | 'relaxed';
export type ContentWidth = 'narrow' | 'standard' | 'wide' | 'full';
export type StatusItem = 'words' | 'characters' | 'readingTime';

export interface Preferences {
  locale: Locale;
  appearance: Appearance;
  documentTheme: DocumentTheme;
  sidebarWidth: number;
  fontSize: number;
  /** Installed font family name; empty keeps the Markdown theme font. */
  fontFamily: string;
  lineHeight: LineHeight;
  contentWidth: ContentWidth;
  /** `#rrggbb`; empty keeps the theme selection color. */
  selectionColor: string;
  newPaneMode: NewPaneMode;
  formatOnSave: boolean;
  restoreSession: boolean;
  lineNumbers: boolean;
  lineWrapping: boolean;
  indentWidth: number;
  highlightCurrentLine: boolean;
  typewriterScroll: boolean;
  termHints: boolean;
  annotationMinimap: boolean;
  annotationColors: Record<AnnotationKind, string>;
  statusItems: StatusItem[];
  /** CJK characters per minute; Latin words are read at a proportional pace. */
  readingSpeed: number;
  checkUpdates: boolean;
}

export const fontSizes = [14, 15, 16, 17, 18, 20, 22] as const;
export const indentWidths = [2, 4] as const;
export const readingSpeeds = [300, 400, 500] as const;
export const statusItems: readonly StatusItem[] = ['words', 'characters', 'readingTime'];
export const defaultAnnotationColors: Record<AnnotationKind, string> = {
  todo: '#d69e16',
  comment: '#2f7bdd',
  question: '#ea701b',
  error: '#e04c66',
};

export const selectionColors = [
  '#3b82f6',
  '#22c55e',
  '#facc15',
  '#fb923c',
  '#ec4899',
  '#8b5cf6',
] as const;

export const defaultPreferences: Preferences = {
  locale: 'zh',
  appearance: 'light',
  documentTheme: 'frame',
  sidebarWidth: 256,
  fontSize: 16,
  fontFamily: '',
  lineHeight: 'standard',
  contentWidth: 'full',
  selectionColor: '',
  newPaneMode: 'same',
  formatOnSave: true,
  restoreSession: true,
  lineNumbers: true,
  lineWrapping: true,
  indentWidth: 2,
  highlightCurrentLine: true,
  typewriterScroll: false,
  termHints: true,
  annotationMinimap: true,
  annotationColors: { ...defaultAnnotationColors },
  statusItems: [...statusItems],
  readingSpeed: 400,
  checkUpdates: true,
};

/** Storage keys predate this module and stay stable so existing settings survive upgrades. */
export const preferenceKeys: Record<keyof Preferences, string> = {
  locale: 'vivin.locale',
  appearance: 'vivin.theme',
  documentTheme: 'vivin.document-theme',
  sidebarWidth: 'vivin.sidebar-width',
  fontSize: 'vivin.editor-font-size',
  fontFamily: 'vivin.editor-font-family',
  lineHeight: 'vivin.line-height',
  contentWidth: 'vivin.content-width',
  selectionColor: 'vivin.selection-color',
  newPaneMode: 'vivin.new-pane-mode',
  formatOnSave: 'vivin.format-on-save',
  restoreSession: 'vivin.restore-session',
  lineNumbers: 'vivin.line-numbers',
  lineWrapping: 'vivin.line-wrapping',
  indentWidth: 'vivin.indent-width',
  highlightCurrentLine: 'vivin.highlight-current-line',
  typewriterScroll: 'vivin.typewriter-scroll',
  termHints: 'vivin.term-hints',
  annotationMinimap: 'vivin.annotation-minimap',
  annotationColors: 'vivin.annotation-colors',
  statusItems: 'vivin.status-items',
  readingSpeed: 'vivin.reading-speed',
  checkUpdates: 'vivin.check-updates',
};

/** Percentage scale stored before the text size became a pixel value. */
const legacyScaleKey = 'vivin.editor-scale';

function oneOf<T extends string | number>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Family names are inserted into CSS, so quotes, escapes and declaration syntax are refused. */
export function validFontFamily(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 120 &&
    !/["'\\;{}<>]/.test(value) &&
    [...value].every((character) => character >= ' ')
  );
}

function hexColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

function annotationColors(value: unknown): Record<AnnotationKind, string> {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const colors = { ...defaultAnnotationColors };
  for (const kind of Object.keys(colors) as AnnotationKind[]) {
    const color = hexColor(source[kind]);
    if (color) colors[kind] = color;
  }
  return colors;
}

function storedFontSize(read: (key: string) => unknown): number {
  const size = read(preferenceKeys.fontSize);
  if (fontSizes.includes(size as (typeof fontSizes)[number])) return size as number;
  const scale = read(legacyScaleKey);
  if (typeof scale !== 'number' || !Number.isFinite(scale)) return defaultPreferences.fontSize;
  const target = 16 * scale;
  return fontSizes.reduce((best, next) =>
    Math.abs(next - target) < Math.abs(best - target) ? next : best,
  );
}

/** Validates each stored value independently; unknown or corrupt values fall back to defaults. */
export function parsePreferences(read: (key: string) => unknown): Preferences {
  const defaults = defaultPreferences;
  const width = read(preferenceKeys.sidebarWidth);
  const fontFamily = read(preferenceKeys.fontFamily);
  const selectionColor = read(preferenceKeys.selectionColor);
  const storedStatus = read(preferenceKeys.statusItems);
  return {
    locale: oneOf(read(preferenceKeys.locale), ['zh', 'en'], defaults.locale),
    appearance: oneOf(
      read(preferenceKeys.appearance),
      ['light', 'dark', 'system'],
      defaults.appearance,
    ),
    documentTheme: oneOf(
      read(preferenceKeys.documentTheme),
      ['frame', 'classic', 'nord'],
      defaults.documentTheme,
    ),
    sidebarWidth:
      typeof width === 'number' && Number.isFinite(width)
        ? Math.round(width)
        : defaults.sidebarWidth,
    fontSize: storedFontSize(read),
    fontFamily: validFontFamily(fontFamily) ? fontFamily : defaults.fontFamily,
    lineHeight: oneOf(
      read(preferenceKeys.lineHeight),
      ['compact', 'standard', 'relaxed'],
      defaults.lineHeight,
    ),
    contentWidth: oneOf(
      read(preferenceKeys.contentWidth),
      ['narrow', 'standard', 'wide', 'full'],
      defaults.contentWidth,
    ),
    selectionColor: hexColor(selectionColor) ?? defaults.selectionColor,
    newPaneMode: oneOf(
      read(preferenceKeys.newPaneMode),
      ['same', 'source', 'rendered'],
      defaults.newPaneMode,
    ),
    formatOnSave: flag(read(preferenceKeys.formatOnSave), defaults.formatOnSave),
    restoreSession: flag(read(preferenceKeys.restoreSession), defaults.restoreSession),
    lineNumbers: flag(read(preferenceKeys.lineNumbers), defaults.lineNumbers),
    lineWrapping: flag(read(preferenceKeys.lineWrapping), defaults.lineWrapping),
    indentWidth: oneOf(read(preferenceKeys.indentWidth), indentWidths, 2),
    highlightCurrentLine: flag(
      read(preferenceKeys.highlightCurrentLine),
      defaults.highlightCurrentLine,
    ),
    typewriterScroll: flag(read(preferenceKeys.typewriterScroll), defaults.typewriterScroll),
    termHints: flag(read(preferenceKeys.termHints), defaults.termHints),
    annotationMinimap: flag(read(preferenceKeys.annotationMinimap), defaults.annotationMinimap),
    annotationColors: annotationColors(read(preferenceKeys.annotationColors)),
    statusItems: Array.isArray(storedStatus)
      ? statusItems.filter((item) => storedStatus.includes(item))
      : [...defaults.statusItems],
    readingSpeed: oneOf(read(preferenceKeys.readingSpeed), readingSpeeds, 400),
    checkUpdates: read(preferenceKeys.checkUpdates) !== false,
  };
}

const lineHeights: Record<LineHeight, { document: number; source: number }> = {
  compact: { document: 1.35, source: 1.5 },
  standard: { document: 1.5, source: 1.7 },
  relaxed: { document: 1.85, source: 2 },
};

const contentWidths: Record<ContentWidth, string> = {
  narrow: '640px',
  standard: '800px',
  wide: '1040px',
  full: '100%',
};

/** CSS custom properties on the app shell that carry the text and layout preferences. */
export function editorStyle(preferences: Preferences): Record<string, string> {
  const style: Record<string, string> = {
    '--editor-font-size': `${preferences.fontSize}px`,
    '--source-font-size': `${preferences.fontSize - 2}px`,
    '--document-line-height': String(lineHeights[preferences.lineHeight].document),
    '--source-line-height': String(lineHeights[preferences.lineHeight].source),
    '--document-width': contentWidths[preferences.contentWidth],
  };
  if (validFontFamily(preferences.fontFamily))
    style['--editor-font-family'] = `"${preferences.fontFamily}"`;
  if (preferences.selectionColor)
    style['--editor-selection'] =
      `color-mix(in srgb, ${preferences.selectionColor} 38%, transparent)`;
  for (const [kind, color] of Object.entries(preferences.annotationColors))
    style[`--annotation-${kind}`] = color;
  return style;
}

export function readStoredJson(storage: Pick<Storage, 'getItem'>, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
