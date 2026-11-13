import { computed, ref } from 'vue';
import { documentThemes } from '../../lib/editor-theme';
import { locale, t } from '../../lib/i18n';
import { documents } from '../documents/use-documents';
import { openHistory } from '../history/use-history';
import { lockSource, project } from '../project/use-project';
import { addDir, addDoc, revealEntry, switchProject } from '../project/use-project-actions';
import { openProjectSearch } from '../search/use-project-search';
import { checkForUpdates } from '../settings/use-updates';
import { usePreferences } from '../settings/use-preferences';
import { notify, report } from '../ui/use-toast';
import {
  focusMode,
  openPalette,
  panel,
  revealLabel,
  settingsOpen,
  toggleSidebar,
} from '../workspace/use-layout';
import {
  activePane,
  activePath,
  currentDoc,
  openFind,
  panes,
  setMode,
  toggleOutline,
  toggleSplit,
} from '../workspace/use-panes';

export interface Command {
  id: string;
  title: string;
  group: string;
  /** `mod` is ⌘ on macOS and Ctrl elsewhere. */
  shortcut?: string;
  enabled?: () => boolean;
  run: () => unknown;
}

export const settingsTab = ref<'general' | 'editor' | 'shortcuts' | 'about'>('general');
const { preferences, theme } = usePreferences();

export function openSettings(tab: typeof settingsTab.value = 'general') {
  settingsTab.value = tab;
  settingsOpen.value = true;
}

const hasProject = () => !!project.value;
const hasDocument = () => !!currentDoc.value;
const canEdit = () => !!activePath.value && !lockSource(activePath.value);

function withDocument(run: (path: string, content: string) => unknown) {
  return () => {
    const doc = currentDoc.value;
    if (doc) return run(doc.path, doc.content);
  };
}

async function exportModule() {
  return import('../export/export-document');
}

export async function formatActive() {
  const path = activePath.value;
  if (!path) return;
  const result = await documents.formatOne(path, true);
  if (result === 'formatted')
    notify(
      t('已格式化，可使用工具栏撤销格式化', 'Formatted. Use the toolbar to undo formatting.'),
      'success',
      {
        label: t('撤销', 'Undo'),
        run: () => documents.undoFormat(path),
      },
    );
  else if (result === 'unchanged') notify(t('文档格式已规范', 'Document is already formatted.'));
  else if (typeof result === 'object')
    notify(
      t('为保留原文，已跳过格式化：', 'Formatting skipped to preserve the source: ') +
        String(result.error),
      'warning',
    );
}

export const exportActions = {
  html: withDocument(async (path, content) =>
    (await exportModule()).exportDocumentHtml(path, content),
  ),
  print: withDocument(async (path, content) => {
    await documents.saveAll();
    return (await exportModule()).printMarkdown(path, content);
  }),
  copy: withDocument(async (path, content) => (await exportModule()).copyRichText(path, content)),
};

export const commands = computed<Command[]>(() => {
  void locale.value;
  const file = t('文件', 'File');
  const documentGroup = t('文档', 'Document');
  const view = t('视图', 'View');
  const app = t('应用', 'App');
  const pane = panes.value[activePane.value];
  return [
    {
      id: 'quick-open',
      title: t('快速打开文档…', 'Go to document…'),
      group: file,
      shortcut: 'mod+p',
      enabled: hasProject,
      run: () => openPalette('files'),
    },
    {
      id: 'palette',
      title: t('命令面板…', 'Command palette…'),
      group: app,
      shortcut: 'mod+k',
      run: () => openPalette('commands'),
    },
    {
      id: 'new-document',
      title: t('新建文档', 'New document'),
      group: file,
      shortcut: 'mod+n',
      enabled: hasProject,
      run: () => addDoc(),
    },
    {
      id: 'new-folder',
      title: t('新建文件夹', 'New folder'),
      group: file,
      enabled: hasProject,
      run: () => addDir(),
    },
    {
      id: 'open-project',
      title: t('打开项目文件夹…', 'Open project folder…'),
      group: file,
      shortcut: 'mod+o',
      run: () => switchProject(false),
    },
    {
      id: 'new-project',
      title: t('新建项目…', 'New project…'),
      group: file,
      run: () => switchProject(true),
    },
    {
      id: 'save',
      title: t('立即保存', 'Save now'),
      group: file,
      shortcut: 'mod+s',
      enabled: hasProject,
      run: () => documents.saveAll(),
    },
    {
      id: 'search',
      title: t('在项目中搜索…', 'Search in project…'),
      group: file,
      shortcut: 'mod+shift+h',
      enabled: hasProject,
      run: () => openProjectSearch(),
    },
    {
      id: 'reveal',
      title: t(`${revealLabel.value}项目文件夹`, `${revealLabel.value}: project folder`),
      group: file,
      enabled: hasProject,
      run: () => revealEntry(),
    },
    {
      id: 'find',
      title: t('在文档中查找', 'Find in document'),
      group: documentGroup,
      shortcut: 'mod+f',
      enabled: hasDocument,
      run: () => openFind(),
    },
    {
      id: 'toggle-mode',
      title:
        pane?.mode === 'source'
          ? t('切换到排版模式', 'Switch to rendered mode')
          : t('切换到源代码模式', 'Switch to source mode'),
      group: documentGroup,
      shortcut: 'mod+/',
      enabled: hasDocument,
      run: () => setMode(activePane.value, pane?.mode === 'source' ? 'rendered' : 'source'),
    },
    {
      id: 'format',
      title: t('格式化文档', 'Format document'),
      group: documentGroup,
      shortcut: 'mod+shift+f',
      enabled: canEdit,
      run: formatActive,
    },
    {
      id: 'outline',
      title: t('显示或隐藏目录', 'Toggle outline'),
      group: documentGroup,
      enabled: hasDocument,
      run: () => toggleOutline(activePane.value),
    },
    {
      id: 'history',
      title: t('版本历史', 'Version history'),
      group: documentGroup,
      enabled: hasDocument,
      run: openHistory,
    },
    {
      id: 'export-html',
      title: t('导出为 HTML…', 'Export as HTML…'),
      group: documentGroup,
      enabled: hasDocument,
      run: exportActions.html,
    },
    {
      id: 'export-pdf',
      title: t('打印或导出 PDF…', 'Print or export PDF…'),
      group: documentGroup,
      enabled: hasDocument,
      run: exportActions.print,
    },
    {
      id: 'copy-rich',
      title: t('复制为富文本', 'Copy as rich text'),
      group: documentGroup,
      enabled: hasDocument,
      run: exportActions.copy,
    },
    {
      id: 'split',
      title: panes.value.length > 1 ? t('关闭分栏', 'Close split') : t('分栏', 'Split view'),
      group: view,
      shortcut: 'mod+\\',
      enabled: hasProject,
      run: toggleSplit,
    },
    {
      id: 'sidebar',
      title: t('显示或隐藏侧栏', 'Toggle sidebar'),
      group: view,
      shortcut: 'mod+shift+e',
      run: toggleSidebar,
    },
    {
      id: 'focus',
      title: focusMode.value ? t('退出专注模式', 'Exit focus mode') : t('专注模式', 'Focus mode'),
      group: view,
      shortcut: 'mod+shift+.',
      enabled: hasDocument,
      run: () => (focusMode.value = !focusMode.value),
    },
    {
      id: 'terms',
      title: t('项目术语', 'Project terms'),
      group: view,
      enabled: hasProject,
      run: () => (panel.value = 'terms'),
    },
    {
      id: 'annotations',
      title: t('项目标注', 'Project annotations'),
      group: view,
      enabled: hasProject,
      run: () => (panel.value = 'annotations'),
    },
    {
      id: 'appearance',
      title:
        theme.value === 'dark'
          ? t('切换到浅色模式', 'Switch to light mode')
          : t('切换到深色模式', 'Switch to dark mode'),
      group: view,
      run: () => (preferences.appearance = theme.value === 'dark' ? 'light' : 'dark'),
    },
    {
      id: 'appearance-system',
      title: t('外观跟随系统', 'Match system appearance'),
      group: view,
      run: () => (preferences.appearance = 'system'),
    },
    ...documentThemes.map((item) => ({
      id: `theme-${item.value}`,
      title: t(`Markdown 主题：${item.label}`, `Markdown theme: ${item.label}`),
      group: view,
      run: () => (preferences.documentTheme = item.value),
    })),
    {
      id: 'language',
      title: locale.value === 'zh' ? 'Switch to English' : '切换到中文',
      group: app,
      run: () => (preferences.locale = locale.value === 'zh' ? 'en' : 'zh'),
    },
    {
      id: 'settings',
      title: t('设置…', 'Settings…'),
      group: app,
      shortcut: 'mod+,',
      run: () => openSettings(),
    },
    {
      id: 'shortcuts',
      title: t('键盘快捷键', 'Keyboard shortcuts'),
      group: app,
      run: () => openSettings('shortcuts'),
    },
    {
      id: 'updates',
      title: t('检查更新', 'Check for updates'),
      group: app,
      run: () => checkForUpdates(true),
    },
  ];
});

export function runCommand(command: Command) {
  if (command.enabled && !command.enabled()) return;
  try {
    const result = command.run();
    if (result instanceof Promise) void result.catch(report);
  } catch (error) {
    report(error);
  }
}

function normalizedKey(event: KeyboardEvent): string {
  if (event.code === 'Period') return '.';
  if (event.code === 'Slash') return '/';
  if (event.code === 'Backslash') return '\\';
  if (event.code === 'Comma') return ',';
  return event.key.toLowerCase();
}

/** Matches a keyboard event against a `mod+shift+x` shortcut. */
export function matchesShortcut(event: KeyboardEvent, shortcut: string, macos: boolean): boolean {
  const keys = shortcut.split('+');
  const key = keys[keys.length - 1] ?? '';
  const mod = macos ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return (
    keys.includes('mod') === mod &&
    keys.includes('shift') === event.shiftKey &&
    !event.altKey &&
    normalizedKey(event) === key
  );
}
