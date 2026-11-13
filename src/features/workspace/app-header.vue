<script setup lang="ts">
import {
  ChevronDown,
  Columns2,
  Command as CommandIcon,
  LoaderCircle,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Search,
  Settings,
  Sun,
  X,
} from '@lucide/vue';
import AppTitlebar from '../../components/app-titlebar.vue';
import { locale, t } from '../../lib/i18n';
import { openSettings, runCommand, commands } from '../commands/use-commands';
import { openHistory } from '../history/use-history';
import {
  busy,
  forgetRecentProject,
  project,
  recentProjects,
  refreshing,
} from '../project/use-project';
import { addDir, addDoc, revealEntry, switchProject } from '../project/use-project-actions';
import { openProjectSearch } from '../search/use-project-search';
import { usePreferences } from '../settings/use-preferences';
import { closeMenus, openMenu, toggleMenu } from '../ui/use-menus';
import {
  openPalette,
  panel,
  platform,
  revealLabel,
  shortcutLabel,
  sidebarVisible,
  sidebarWidth,
  toggleSidebar,
} from './use-layout';
import { currentDoc, panes, toggleSplit } from './use-panes';

const { preferences, theme } = usePreferences();

function shortcutOf(id: string): string {
  const shortcut = commands.value.find((command) => command.id === id)?.shortcut;
  return shortcut ? shortcutLabel(shortcut) : '';
}

function run(id: string) {
  closeMenus();
  const command = commands.value.find((item) => item.id === id);
  if (command) runCommand(command);
}

function menuAction(action: () => unknown) {
  closeMenus();
  void action();
}

function toggleAppearance() {
  preferences.appearance = theme.value === 'dark' ? 'light' : 'dark';
}
</script>

<template>
  <AppTitlebar
    :sidebar-open="!!project && sidebarVisible"
    :sidebar-width="sidebarWidth"
    :platform="platform"
    :locale="locale"
  >
    <template #sidebar-control>
      <button
        v-if="project"
        class="rounded-md p-1.5 text-slate-600 hover:bg-slate-200/70"
        :title="`${t('显示或隐藏侧栏', 'Toggle sidebar')} ${shortcutOf('sidebar')}`"
        :aria-label="t('显示或隐藏侧栏', 'Toggle sidebar')"
        @click.stop="toggleSidebar"
      >
        <PanelLeft :size="18" />
      </button>
    </template>
    <div class="relative flex min-w-0 items-center gap-2">
      <button
        class="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm font-semibold hover:bg-slate-200/70 disabled:opacity-50"
        :title="t('切换项目', 'Switch project')"
        :aria-label="t('切换项目', 'Switch project')"
        aria-haspopup="menu"
        :aria-expanded="openMenu === 'project'"
        :disabled="busy"
        @click.stop="toggleMenu('project')"
      >
        <span class="truncate">{{ project?.name || 'vivin' }}</span>
        <ChevronDown :size="14" class="shrink-0 text-slate-500" />
      </button>
      <div
        v-if="openMenu === 'project'"
        class="app-menu absolute left-0 top-9 z-50 w-80 max-w-[calc(100vw-32px)]"
        role="menu"
        :aria-label="t('最近项目', 'Recent projects')"
        @click.stop
      >
        <p class="px-3 py-2 text-xs font-medium text-slate-500">
          {{ t('最近项目', 'Recent projects') }}
        </p>
        <div class="max-h-72 overflow-y-auto">
          <p v-if="!recentProjects.length" class="px-3 py-3 text-xs text-slate-400">
            {{ t('打开的项目会自动保存在这里', 'Opened projects will appear here automatically') }}
          </p>
          <div v-for="recent in recentProjects" :key="recent.path" class="flex items-center">
            <button
              class="min-w-0 flex-1 rounded-lg px-3 py-2 text-left hover:bg-slate-100 disabled:opacity-50"
              :class="recent.path === project?.path ? 'text-blue-700' : ''"
              :aria-current="recent.path === project?.path ? 'true' : undefined"
              :title="recent.path"
              :disabled="busy"
              role="menuitem"
              @click.stop="switchProject(false, recent.path)"
            >
              <span class="block truncate font-medium">{{ recent.name }}</span>
              <span class="block truncate text-[11px] text-slate-400">{{ recent.path }}</span>
            </button>
            <button
              class="mr-1 shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100"
              :title="t('从最近项目中移除', 'Remove from recent projects')"
              :aria-label="t('从最近项目中移除', 'Remove from recent projects')"
              role="menuitem"
              @click.stop="forgetRecentProject(recent.path)"
            >
              <X :size="14" />
            </button>
          </div>
        </div>
        <div class="app-menu-divider" />
        <button class="app-menu-item" role="menuitem" @click.stop="switchProject(false)">
          <span>{{ t('打开项目文件夹…', 'Open project folder…') }}</span>
          <kbd>{{ shortcutOf('open-project') }}</kbd>
        </button>
        <button class="app-menu-item" role="menuitem" @click.stop="switchProject(true)">
          <span>{{ t('新建项目…', 'New project…') }}</span>
        </button>
      </div>
      <LoaderCircle
        v-if="busy || refreshing"
        :size="15"
        class="animate-spin text-blue-600"
        :aria-label="t('正在加载项目', 'Loading project')"
      />
    </div>
    <div class="flex shrink-0 items-center gap-1 text-slate-600">
      <button
        v-if="project"
        class="header-search mr-1.5 flex w-44 items-center gap-2 rounded-lg bg-white/80 px-2.5 py-1.5 text-left text-xs text-slate-400 lg:w-64"
        :aria-label="t('搜索或跳转到文档', 'Search or go to a document')"
        @click.stop="openPalette('files')"
      >
        <Search :size="15" class="shrink-0" />
        <span class="min-w-0 flex-1 truncate">{{ t('搜索或跳转到文档…', 'Go to document…') }}</span>
        <kbd class="hidden shrink-0 lg:inline">{{ shortcutOf('quick-open') }}</kbd>
      </button>
      <button
        v-if="project"
        class="rounded-md p-1.5 hover:bg-slate-200/70"
        :class="panes.length > 1 ? 'text-blue-600' : ''"
        :title="`${panes.length > 1 ? t('关闭分栏', 'Close split') : t('分栏', 'Split view')} ${shortcutOf('split')}`"
        :aria-pressed="panes.length > 1"
        @click.stop="toggleSplit"
      >
        <Columns2 :size="17" />
      </button>
      <button
        class="rounded-md p-1.5 hover:bg-slate-200/70"
        :title="
          theme === 'dark'
            ? t('切换到浅色模式', 'Switch to light mode')
            : t('切换到深色模式', 'Switch to dark mode')
        "
        @click.stop="toggleAppearance"
      >
        <Sun v-if="theme === 'dark'" :size="17" /><Moon v-else :size="17" />
      </button>
      <button
        class="rounded-md p-1.5 hover:bg-slate-200/70"
        :title="`${t('设置', 'Settings')} ${shortcutOf('settings')}`"
        @click.stop="menuAction(() => openSettings())"
      >
        <Settings :size="17" />
      </button>
      <div class="relative">
        <button
          class="rounded-md p-1.5 hover:bg-slate-200/70"
          :title="t('更多', 'More')"
          aria-haspopup="menu"
          :aria-expanded="openMenu === 'more'"
          @click.stop="toggleMenu('more')"
        >
          <MoreHorizontal :size="18" />
        </button>
        <div
          v-if="openMenu === 'more'"
          class="app-menu absolute right-0 top-9 z-50 w-60"
          role="menu"
          @click.stop
        >
          <template v-if="project">
            <button class="app-menu-item" role="menuitem" @click="menuAction(() => addDoc())">
              <span>{{ t('新建文档', 'New document') }}</span>
              <kbd>{{ shortcutOf('new-document') }}</kbd>
            </button>
            <button class="app-menu-item" role="menuitem" @click="menuAction(() => addDir())">
              <span>{{ t('新建文件夹', 'New folder') }}</span>
            </button>
            <div class="app-menu-divider" />
            <button
              class="app-menu-item"
              role="menuitem"
              @click="menuAction(() => openProjectSearch())"
            >
              <span>{{ t('在项目中搜索', 'Search in project') }}</span>
              <kbd>{{ shortcutOf('search') }}</kbd>
            </button>
            <button
              class="app-menu-item"
              role="menuitem"
              @click="menuAction(() => (panel = 'terms'))"
            >
              <span>{{ t('项目术语', 'Project terms') }}</span>
            </button>
            <button
              class="app-menu-item"
              role="menuitem"
              @click="menuAction(() => (panel = 'annotations'))"
            >
              <span>{{ t('项目标注', 'Project annotations') }}</span>
            </button>
            <button
              class="app-menu-item"
              role="menuitem"
              :disabled="!currentDoc"
              @click="menuAction(openHistory)"
            >
              <span>{{ t('版本历史', 'Version history') }}</span>
            </button>
            <button class="app-menu-item" role="menuitem" @click="menuAction(() => revealEntry())">
              <span>{{ revealLabel }}</span>
            </button>
            <div class="app-menu-divider" />
          </template>
          <button class="app-menu-item" role="menuitem" @click="run('palette')">
            <span class="flex items-center gap-2"
              ><CommandIcon :size="14" />{{ t('命令面板', 'Command palette') }}</span
            >
            <kbd>{{ shortcutOf('palette') }}</kbd>
          </button>
          <button class="app-menu-item" role="menuitem" @click="run('shortcuts')">
            <span>{{ t('键盘快捷键', 'Keyboard shortcuts') }}</span>
          </button>
        </div>
      </div>
    </div>
  </AppTitlebar>
</template>
