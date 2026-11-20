<script setup lang="ts">
import { ChevronDown, LoaderCircle, X } from '@lucide/vue';
import { computed } from 'vue';
import { t } from '../../lib/i18n';
import { commands } from '../commands/use-commands';
import {
  busy,
  forgetRecentProject,
  project,
  recentProjects,
  refreshing,
} from '../project/use-project';
import { switchProject } from '../project/use-project-actions';
import { openMenu, toggleMenu } from '../ui/use-menus';
import { shortcutLabel } from './use-layout';

const openProjectShortcut = computed(
  () => commands.value.find((command) => command.id === 'open-project')?.shortcut,
);
</script>

<template>
  <div class="relative flex min-w-0 items-center gap-2">
    <button
      class="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm font-semibold hover:bg-slate-200/70 disabled:opacity-50"
      :title="
        project
          ? `${t('切换项目', 'Switch project')}: ${project.name}`
          : t('切换项目', 'Switch project')
      "
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
        <kbd>{{ openProjectShortcut ? shortcutLabel(openProjectShortcut) : '' }}</kbd>
      </button>
      <button class="app-menu-item" role="menuitem" @click.stop="switchProject(true)">
        <span>{{ t('新建项目…', 'New project…') }}</span>
      </button>
    </div>
    <LoaderCircle
      v-if="busy || refreshing"
      :size="15"
      class="shrink-0 animate-spin text-blue-600"
      :aria-label="t('正在加载项目', 'Loading project')"
    />
  </div>
</template>
