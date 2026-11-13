<script setup lang="ts">
import {
  BookOpenText,
  Check,
  ChevronDown,
  CircleAlert,
  CodeXml,
  ListTree,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Undo2,
  WandSparkles,
  X,
} from '@lucide/vue';
import { computed, defineAsyncComponent } from 'vue';
import DocumentFind from '../../components/document-find.vue';
import LoadingState from '../../components/loading-state.vue';
import MarkdownOutlinePanel from '../../components/markdown-outline-panel.vue';
import { locale, t } from '../../lib/i18n';
import type { AnnotationKind } from '../../lib/project-api';
import { textStats } from '../../lib/text-stats';
import {
  annotationKinds,
  annotationMarksByDocument,
  handleAnnotationClick,
  handleAnnotationHover,
  kindColor,
  kindLabel,
  requestEditorAnnotation,
  scheduleHideAnnotationPopover,
} from '../annotations/use-annotations';
import { commands, exportActions, formatActive } from '../commands/use-commands';
import { documents } from '../documents/use-documents';
import { openHistory } from '../history/use-history';
import { lockSource } from '../project/use-project';
import { usePreferences } from '../settings/use-preferences';
import {
  hideTermNow,
  scheduleHideTerm,
  showTermHover,
  termMarksByDocument,
} from '../terms/use-terms';
import { closeMenus, openMenu, toggleMenu } from '../ui/use-menus';
import { notify } from '../ui/use-toast';
import { focusMode, shortcutLabel } from './use-layout';
import {
  activePane,
  closeFind,
  closePane,
  findPanels,
  jumpTo,
  jumpToHeading,
  loadingPanes,
  navigateFind,
  openReference,
  panes,
  renderedEditorRef,
  replaceFind,
  selectedWords,
  setMode,
  setSearchHighlights,
  sourceEditorRef,
  sourceRevealRequests,
  toggleOutline,
  type Pane,
} from './use-panes';

const MarkdownRenderedEditor = defineAsyncComponent({
  loader: () => import('../../components/markdown-rendered-editor.vue'),
  loadingComponent: LoadingState,
  delay: 0,
});
const MarkdownSourceEditor = defineAsyncComponent({
  loader: () => import('../../components/markdown-source-editor.vue'),
  loadingComponent: LoadingState,
  delay: 0,
});

const props = defineProps<{ pane: Pane; index: number }>();
const { theme } = usePreferences();

const doc = computed(() => (props.pane.path ? documents.docs.value[props.pane.path] : undefined));
const locked = computed(() => (props.pane.path ? lockSource(props.pane.path) : null));
const saveState = computed(() =>
  props.pane.path ? documents.saveState(props.pane.path) : 'saved',
);
const stats = computed(() =>
  textStats(
    props.pane.path
      ? (documents.markContents.value[props.pane.path] ?? doc.value?.content ?? '')
      : '',
  ),
);
const selected = computed(() => selectedWords.value[props.pane.id] ?? 0);
const marks = computed(() =>
  props.pane.path ? (annotationMarksByDocument.value[props.pane.path] ?? []) : [],
);
const visibleMarks = computed(() =>
  marks.value.filter((mark) => props.pane.filters.includes(mark.kind)),
);
const menuId = computed(() => `pane-${props.pane.id}`);
const fileName = computed(() => props.pane.path?.slice(props.pane.path.lastIndexOf('/') + 1) ?? '');
const folder = computed(() => {
  const path = props.pane.path ?? '';
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
});

function shortcutOf(id: string): string {
  const shortcut = commands.value.find((command) => command.id === id)?.shortcut;
  return shortcut ? shortcutLabel(shortcut) : '';
}

function activate() {
  activePane.value = props.index;
}

function menuAction(action: () => unknown) {
  closeMenus();
  activate();
  void action();
}

function format() {
  activate();
  void formatActive();
}

function undoFormat() {
  if (props.pane.path) documents.undoFormat(props.pane.path);
}

function retrySave() {
  if (props.pane.path) void documents.saveOne(props.pane.path);
}

function setContent(content: string) {
  if (props.pane.path) documents.setContent(props.pane.path, content);
}

function onMouseMove(event: MouseEvent) {
  if (handleAnnotationHover(event)) hideTermNow();
  else showTermHover(event, props.pane.path);
}

function onMouseLeave() {
  scheduleHideTerm();
  scheduleHideAnnotationPopover();
}

function toggleFilter(kind: AnnotationKind) {
  const filters = props.pane.filters;
  props.pane.filters = filters.includes(kind)
    ? filters.filter((value) => value !== kind)
    : [...filters, kind];
}

function minimapTop(offset: number): string {
  const length = Math.max(1, doc.value?.content.length ?? 1);
  return `${Math.max(4, Math.min(96, (100 * offset) / length))}%`;
}

function findRef(value: unknown) {
  if (value) findPanels.set(props.pane.id, value as { focus(selection?: string): void });
  else findPanels.delete(props.pane.id);
}

function copyPath() {
  closeMenus();
  if (!props.pane.path) return;
  void navigator.clipboard
    .writeText(props.pane.path)
    .then(() => notify(t('已复制文档路径', 'Path copied'), 'success'));
}

const formatTitle = computed(() => `${t('格式化文档', 'Format document')} ${shortcutOf('format')}`);
</script>

<template>
  <section
    :data-pane-index="index"
    class="document-pane relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white"
    :class="panes.length > 1 && index === activePane ? 'is-active-pane' : ''"
    @pointerdown="activate"
    @focusin="activate"
    @click.capture="handleAnnotationClick"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
  >
    <Transition name="document-switch" mode="out-in">
      <LoadingState
        v-if="loadingPanes.has(index)"
        :label="t('正在打开文档…', 'Opening document…')"
      />
      <div v-else-if="pane.path && doc" :key="pane.path" class="flex min-h-0 flex-1 flex-col">
        <div class="document-toolbar relative shrink-0 text-sm">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span class="min-w-0 truncate" :title="pane.path">
              <span v-if="folder" class="text-slate-400">{{ folder }}/</span
              ><span class="font-medium">{{ fileName }}</span>
            </span>
            <span
              v-if="locked"
              class="flex shrink-0 items-center gap-1 text-xs text-amber-700"
              :title="
                locked === pane.path
                  ? t('已锁定，不能修改', 'Locked and read-only')
                  : t(`由 ${locked} 锁定`, `Locked by ${locked}`)
              "
              ><LockKeyhole :size="13" /><span class="hidden xl:inline">{{
                t('已锁定', 'Locked')
              }}</span></span
            >
            <span v-else class="save-state shrink-0" :data-state="saveState" role="status">
              <template v-if="saveState === 'saving'"
                ><LoaderCircle :size="12" class="animate-spin" />{{
                  t('正在保存', 'Saving')
                }}</template
              >
              <template v-else-if="saveState === 'unsaved'"
                ><i class="h-1.5 w-1.5 rounded-full bg-current" />{{
                  t('未保存', 'Unsaved')
                }}</template
              >
              <button
                v-else-if="saveState === 'failed'"
                class="flex items-center gap-1 rounded px-1 hover:bg-rose-50"
                :title="doc.error ?? ''"
                @click.stop="retrySave"
              >
                <CircleAlert :size="12" />{{ t('保存失败 · 重试', 'Save failed · Retry') }}
              </button>
              <template v-else><Check :size="12" />{{ t('已保存', 'Saved') }}</template>
            </span>
          </div>
          <div class="document-actions flex shrink-0 items-center gap-1.5 text-slate-500">
            <button
              class="rounded-md p-1.5 hover:bg-slate-100"
              :class="pane.outlineOpen ? 'bg-blue-50 text-blue-700' : ''"
              :title="t('文档目录', 'Document outline')"
              :aria-controls="`vivin-outline-${pane.id}`"
              :aria-expanded="pane.outlineOpen"
              @click.stop="toggleOutline(index)"
            >
              <ListTree :size="17" />
            </button>
            <div class="view-switch" role="group" :aria-label="t('编辑模式', 'Editing mode')">
              <button
                v-for="mode in ['rendered', 'source'] as const"
                :key="mode"
                class="view-switch-button"
                :class="pane.mode === mode ? 'is-active' : ''"
                :title="`${mode === 'source' ? t('源代码模式：直接编辑 Markdown 原文', 'Source mode: edit the Markdown text') : t('排版模式：所见即所得地编辑', 'Rendered mode: edit the formatted document')} ${shortcutOf('toggle-mode')}`"
                :aria-pressed="pane.mode === mode"
                @click.stop="setMode(index, mode)"
              >
                <CodeXml v-if="mode === 'source'" :size="14" />
                <BookOpenText v-else :size="14" />
                <span>{{ mode === 'source' ? t('源代码', 'Source') : t('排版', 'Rendered') }}</span>
              </button>
            </div>
            <button
              class="format-button"
              :disabled="!!locked || doc.conflict || documents.formattingPaths.value.has(pane.path)"
              :title="formatTitle"
              :aria-label="t('格式化文档', 'Format document')"
              @click.stop="format"
            >
              <LoaderCircle
                v-if="documents.formattingPaths.value.has(pane.path)"
                :size="16"
                class="animate-spin"
              /><WandSparkles v-else :size="16" />
            </button>
            <button
              v-if="documents.canUndoFormat(pane.path)"
              class="format-button"
              :title="t('撤销格式化', 'Undo formatting')"
              @click.stop="undoFormat"
            >
              <Undo2 :size="16" />
            </button>
            <div class="relative">
              <button
                class="rounded-md p-1.5 hover:bg-slate-100"
                :title="t('文档操作', 'Document actions')"
                aria-haspopup="menu"
                :aria-expanded="openMenu === menuId"
                @click.stop="toggleMenu(menuId)"
              >
                <MoreHorizontal :size="17" />
              </button>
              <div
                v-if="openMenu === menuId"
                class="app-menu absolute right-0 top-9 z-40 w-56"
                role="menu"
                @click.stop
              >
                <button class="app-menu-item" role="menuitem" @click="menuAction(openHistory)">
                  {{ t('版本历史', 'Version history') }}
                </button>
                <div class="app-menu-divider" />
                <button
                  class="app-menu-item"
                  role="menuitem"
                  @click="menuAction(exportActions.html)"
                >
                  {{ t('导出为 HTML…', 'Export as HTML…') }}
                </button>
                <button
                  class="app-menu-item"
                  role="menuitem"
                  @click="menuAction(exportActions.print)"
                >
                  {{ t('打印或导出 PDF…', 'Print or export PDF…') }}
                </button>
                <button
                  class="app-menu-item"
                  role="menuitem"
                  @click="menuAction(exportActions.copy)"
                >
                  {{ t('复制为富文本', 'Copy as rich text') }}
                </button>
                <button class="app-menu-item" role="menuitem" @click="copyPath">
                  {{ t('复制文档路径', 'Copy document path') }}
                </button>
                <div class="app-menu-divider" />
                <button
                  class="app-menu-item"
                  role="menuitem"
                  @click="menuAction(() => (focusMode = !focusMode))"
                >
                  <span>{{ t('专注模式', 'Focus mode') }}</span>
                  <kbd>{{ shortcutOf('focus') }}</kbd>
                </button>
              </div>
            </div>
            <button
              v-if="panes.length > 1"
              class="rounded-md p-1.5 text-slate-400 hover:bg-slate-100"
              :title="t('关闭分栏', 'Close pane')"
              @click.stop="closePane(index)"
            >
              <X :size="16" />
            </button>
          </div>
        </div>
        <DocumentFind
          v-if="pane.findOpen"
          :key="`${pane.id}:${pane.path}:find`"
          :ref="findRef"
          :content="doc.content"
          :readonly="!!locked"
          :locale="locale"
          @highlights="(matches, active) => setSearchHighlights(index, matches, active)"
          @navigate="navigateFind(index, $event)"
          @replace="(matches, replacement) => replaceFind(index, matches, replacement)"
          @close="closeFind(index)"
        />
        <div class="flex min-h-0 flex-1">
          <MarkdownOutlinePanel
            v-if="pane.outlineOpen"
            :panel-id="`vivin-outline-${pane.id}`"
            :markdown="doc.content"
            :locale="locale"
            @select="jumpToHeading(index, $event)"
          />
          <div class="markdown-canvas flex min-h-0 min-w-0 flex-1">
            <MarkdownSourceEditor
              v-if="pane.mode === 'source'"
              :key="`${pane.id}:${pane.path}:source`"
              :ref="sourceEditorRef(pane.id)"
              :model-value="doc.content"
              :document-path="pane.path"
              :reveal-request="sourceRevealRequests[index] ?? undefined"
              :annotations="marks"
              :search-matches="pane.searchMatches"
              :active-search-offset="pane.activeSearchOffset"
              :readonly="!!locked"
              :locale="locale"
              class="min-w-0 flex-1"
              @update:model-value="setContent"
              @error="notify($event, 'error')"
              @annotation-request="
                (kind: AnnotationKind, selection: { quote: string; offset: number }) =>
                  requestEditorAnnotation(index, kind, selection)
              "
            />
            <MarkdownRenderedEditor
              v-else
              :key="`${pane.id}:${pane.path}:rendered`"
              :ref="renderedEditorRef(pane.id)"
              :model-value="doc.content"
              :document-path="pane.path"
              :annotations="marks"
              :search-matches="pane.searchMatches"
              :active-search-offset="pane.activeSearchOffset"
              :terms="termMarksByDocument[pane.path]"
              :locale="locale"
              :readonly="!!locked"
              :theme="theme"
              class="min-w-0 flex-1"
              @update:model-value="setContent"
              @error="notify($event, 'error')"
              @open-reference="openReference(pane.path, $event)"
              @annotation-request="
                (kind: AnnotationKind, selection: { quote: string; offset: number }) =>
                  requestEditorAnnotation(index, kind, selection)
              "
              @incompatible="setMode(index, 'source')"
            />
          </div>
          <div class="annotation-minimap relative flex w-8 shrink-0 flex-col items-center py-2">
            <div class="group relative mb-2">
              <button
                :title="t('筛选缩略条中的标注', 'Filter annotation minimap')"
                class="rounded p-1 hover:bg-slate-100"
              >
                <ChevronDown :size="13" />
              </button>
              <div
                class="app-menu absolute top-0 right-6 z-20 hidden w-28 group-hover:block"
                role="menu"
              >
                <button
                  v-for="kind in annotationKinds"
                  :key="kind.value"
                  class="app-menu-item"
                  role="menuitemcheckbox"
                  :aria-checked="pane.filters.includes(kind.value)"
                  @click.stop="toggleFilter(kind.value)"
                >
                  <span class="flex items-center gap-1.5">
                    <Check
                      :size="12"
                      :class="pane.filters.includes(kind.value) ? '' : 'invisible'"
                    />
                    {{ kindLabel(kind.value) }}
                  </span>
                </button>
              </div>
            </div>
            <div class="relative w-full flex-1">
              <button
                v-for="mark in visibleMarks"
                :key="mark.id"
                :aria-label="`${kindLabel(mark.kind)}: ${mark.quote}`"
                class="annotation-minimap-mark group absolute left-1 flex h-5 w-6 -translate-y-1/2 items-center justify-center focus-visible:outline-2 focus-visible:outline-blue-500"
                :style="{ top: minimapTop(mark.offset) }"
                @click.stop="jumpTo(pane.path, mark.offset, mark.length, mark.id)"
              >
                <span
                  class="h-[3px] w-3.5 rounded-full transition-[width] group-hover:w-5 group-focus-visible:w-5"
                  :style="{ background: kindColor(mark.kind) }"
                />
              </button>
            </div>
          </div>
        </div>
        <footer class="document-status shrink-0" role="status">
          <span v-if="selected">{{ t(`已选 ${selected} 字`, `${selected} selected`) }}</span>
          <span>{{ t(`${stats.words} 字`, `${stats.words} words`) }}</span>
          <span>{{ t(`${stats.characters} 字符`, `${stats.characters} characters`) }}</span>
          <span v-if="stats.minutes">{{
            t(`约 ${stats.minutes} 分钟读完`, `${stats.minutes} min read`)
          }}</span>
        </footer>
      </div>
      <slot v-else />
    </Transition>
  </section>
</template>
