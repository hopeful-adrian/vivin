<script setup lang="ts">
import {
  Columns2,
  Command as CommandIcon,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Search,
  Settings,
  Sun,
} from '@lucide/vue';
import { computed } from 'vue';
import AppTitlebar from '../../components/app-titlebar.vue';
import { locale, t } from '../../lib/i18n';
import { openSettings, runCommand, commands } from '../commands/use-commands';
import { openHistory } from '../history/use-history';
import { project } from '../project/use-project';
import { addDir, addDoc, revealEntry } from '../project/use-project-actions';
import { openProjectSearch } from '../search/use-project-search';
import { usePreferences } from '../settings/use-preferences';
import { closeMenus, openMenu, toggleMenu } from '../ui/use-menus';
import ProjectSwitcher from './project-switcher.vue';
import {
  openPalette,
  panel,
  platform,
  revealLabel,
  shortcutLabel,
  sidebarVisible,
  sidebarWidth,
  toggleSidebar,
  windowFullscreen,
} from './use-layout';
import { currentDoc, panes, toggleSplit } from './use-panes';

const { preferences, theme } = usePreferences();
const sidebarOpenWithProject = computed(() => !!project.value && sidebarVisible.value);

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
    :sidebar-open="sidebarOpenWithProject"
    :sidebar-width="sidebarWidth"
    :platform="platform"
    :traffic-lights="platform === 'macos' && !windowFullscreen"
    :locale="locale"
  >
    <template #sidebar-control>
      <ProjectSwitcher v-if="sidebarOpenWithProject" class="flex-1" />
      <button
        v-if="project"
        class="shrink-0 rounded-md p-1.5 text-slate-600 hover:bg-slate-200/70"
        :title="`${t('显示或隐藏侧栏', 'Toggle sidebar')} ${shortcutOf('sidebar')}`"
        :aria-label="t('显示或隐藏侧栏', 'Toggle sidebar')"
        @click.stop="toggleSidebar"
      >
        <PanelLeft :size="18" />
      </button>
    </template>
    <ProjectSwitcher v-if="!sidebarOpenWithProject" />
    <div class="ml-auto flex shrink-0 items-center gap-1 text-slate-600">
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
