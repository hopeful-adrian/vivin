import { computed, ref, watch } from 'vue';
import { t } from '../../lib/i18n';
import { usePreferences } from '../settings/use-preferences';

export type SidePanel = 'none' | 'search' | 'terms' | 'annotations' | 'history';
export type Platform = 'macos' | 'windows' | 'linux';

/** Below this window width the sidebar collapses on its own and returns when there is room. */
const narrowWidth = 1040;
const minSidebarWidth = 200;

const { preferences } = usePreferences();

export const platform = ref<Platform>('macos');
export const windowExpanded = ref(false);
export const sidebarOpen = ref(window.innerWidth >= narrowWidth);
let autoCollapsed = !sidebarOpen.value;
export const focusMode = ref(false);
export const panel = ref<SidePanel>('none');
export const readingPanel = computed(() => panel.value === 'terms');
export const settingsOpen = ref(false);
export const palette = ref<{ mode: 'files' | 'commands'; query: string } | null>(null);
export const maxSidebarWidth = ref(maxWidth());
export const sidebarVisible = computed(() => sidebarOpen.value && !focusMode.value);

function maxWidth() {
  return Math.max(minSidebarWidth, Math.min(420, window.innerWidth - 480));
}

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.max(minSidebarWidth, Math.min(maxWidth(), width)));
}

export const sidebarWidth = computed({
  get: () => clampSidebarWidth(preferences.sidebarWidth),
  set: (width: number) => (preferences.sidebarWidth = clampSidebarWidth(width)),
});

export function toggleSidebar() {
  if (focusMode.value) focusMode.value = false;
  sidebarOpen.value = !sidebarOpen.value;
  autoCollapsed = false;
}

export function onWindowResize() {
  maxSidebarWidth.value = maxWidth();
  const narrow = window.innerWidth < narrowWidth;
  if (narrow && sidebarOpen.value && !autoCollapsed) {
    sidebarOpen.value = false;
    autoCollapsed = true;
  } else if (!narrow && autoCollapsed) {
    sidebarOpen.value = true;
    autoCollapsed = false;
  }
}

export function openPalette(mode: 'files' | 'commands', query = '') {
  palette.value = { mode, query };
}

watch(focusMode, (value) => {
  if (value && panel.value !== 'none') panel.value = 'none';
});

export const revealLabel = computed(() =>
  platform.value === 'macos'
    ? t('在 Finder 中显示', 'Show in Finder')
    : platform.value === 'windows'
      ? t('在文件资源管理器中显示', 'Show in File Explorer')
      : t('在文件管理器中显示', 'Show in file manager'),
);

export const trashLabel = computed(() =>
  platform.value === 'macos' ? t('废纸篓', 'Trash') : t('回收站', 'Recycle Bin'),
);

export const modKey = computed(() => (platform.value === 'macos' ? '⌘' : 'Ctrl+'));
export const shiftKey = computed(() => (platform.value === 'macos' ? '⇧' : 'Shift+'));

/** Formats a shortcut such as `mod+shift+f` for the current platform. */
export function shortcutLabel(keys: string): string {
  return keys
    .split('+')
    .map((key) =>
      key === 'mod'
        ? modKey.value
        : key === 'shift'
          ? shiftKey.value
          : key.length === 1
            ? key.toUpperCase()
            : key,
    )
    .join('');
}
