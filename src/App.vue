<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import AppDialog from './components/app-dialog.vue';
import AppToast from './components/app-toast.vue';
import AppTooltip from './components/app-tooltip.vue';
import LoadingState from './components/loading-state.vue';
import AnnotationPopover from './features/annotations/annotation-popover.vue';
import {
  disposeAnnotationPopover,
  positionAnnotationPopover,
} from './features/annotations/use-annotations';
import CommandPalette from './features/commands/command-palette.vue';
import { handleShortcut } from './features/commands/use-shortcuts';
import { documents } from './features/documents/use-documents';
import ProjectSidebar from './features/project/project-sidebar.vue';
import { busy, project } from './features/project/use-project';
import SettingsDialog from './features/settings/settings-dialog.vue';
import { usePreferences } from './features/settings/use-preferences';
import TermDialog from './features/terms/term-dialog.vue';
import TermPopover from './features/terms/term-popover.vue';
import { closeMenus } from './features/ui/use-menus';
import AppHeader from './features/workspace/app-header.vue';
import DocumentPane from './features/workspace/document-pane.vue';
import SidePanel from './features/workspace/side-panel.vue';
import {
  focusMode,
  onWindowResize,
  panel,
  platform,
  readingPanel,
  sidebarVisible,
  windowExpanded,
} from './features/workspace/use-layout';
import { installNativeEvents } from './features/workspace/use-native-events';
import {
  activePane,
  panes,
  split,
  startSplitResize,
  updateSelectionStats,
} from './features/workspace/use-panes';
import WelcomeView from './features/workspace/welcome-view.vue';
import { installErrorLogging } from './lib/app-log';
import { locale, t } from './lib/i18n';

const { preferences, theme } = usePreferences();
let uninstallNativeEvents: (() => void) | undefined;

onMounted(() => {
  installErrorLogging();
  window.addEventListener('keydown', handleShortcut, true);
  window.addEventListener('scroll', positionAnnotationPopover, true);
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('selectionchange', updateSelectionStats);
  uninstallNativeEvents = installNativeEvents();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleShortcut, true);
  window.removeEventListener('scroll', positionAnnotationPopover, true);
  window.removeEventListener('resize', onWindowResize);
  document.removeEventListener('selectionchange', updateSelectionStats);
  uninstallNativeEvents?.();
  disposeAnnotationPopover();
  documents.dispose();
});
</script>

<template>
  <div
    :class="[
      'app-shell flex flex-col overflow-hidden bg-[#f3f6fa] text-slate-900',
      windowExpanded || platform === 'macos'
        ? 'h-screen rounded-none'
        : 'm-2 h-[calc(100vh-16px)] rounded-xl shadow-[0_4px_14px_-3px_rgb(15_23_42_/_18%)]',
      theme === 'dark' ? 'theme-dark' : '',
      focusMode ? 'is-focus-mode' : '',
    ]"
    :data-document-theme="preferences.documentTheme"
    :data-platform="platform"
    :style="{ '--editor-scale': String(preferences.editorScale) }"
    @click="closeMenus"
  >
    <AppHeader />
    <div class="flex min-h-0 flex-1">
      <ProjectSidebar v-if="project && sidebarVisible" />
      <main class="flex min-w-0 flex-1 flex-col">
        <div
          :class="windowExpanded ? 'gap-0' : 'gap-3 px-4 pb-4'"
          class="relative flex min-h-0 flex-1"
        >
          <div class="flex min-w-0 flex-1">
            <template v-for="(pane, index) in panes" :key="pane.id">
              <div
                v-if="index === 1"
                v-show="!readingPanel"
                class="split-handle group flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center"
                role="separator"
                aria-orientation="vertical"
                :aria-label="t('调整分栏宽度', 'Resize panes')"
                @pointerdown.prevent="startSplitResize"
              >
                <div class="h-10 w-1 rounded bg-slate-300 group-hover:bg-blue-400" />
              </div>
              <DocumentPane
                v-show="!readingPanel || index === activePane"
                :pane="pane"
                :index="index"
                :style="
                  panes.length === 2 && !readingPanel
                    ? { flex: `${index === 0 ? split : 100 - split} 1 0%` }
                    : {}
                "
              >
                <WelcomeView />
              </DocumentPane>
            </template>
          </div>
          <div v-if="busy" class="absolute inset-0 z-20 flex bg-[#f3f6fa]/85" aria-busy="true">
            <LoadingState :label="t('正在打开项目…', 'Opening project…')" />
          </div>
          <SidePanel v-if="panel !== 'none' && project" />
        </div>
      </main>
    </div>
    <AnnotationPopover />
    <TermPopover />
    <TermDialog />
    <CommandPalette />
    <SettingsDialog />
    <AppDialog />
    <AppToast />
    <AppTooltip :locale="locale" />
  </div>
</template>
