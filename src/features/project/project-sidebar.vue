<script setup lang="ts">
import {
  BookMarked,
  Bookmark,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  LockKeyhole,
} from '@lucide/vue';
import { ref } from 'vue';
import { t } from '../../lib/i18n';
import { openProjectResource, type TreeNode } from '../../lib/project-api';
import { annotationKinds, annotationFilter, kindLabel } from '../annotations/use-annotations';
import { closeMenus, openMenu } from '../ui/use-menus';
import { report } from '../ui/use-toast';
import {
  clampSidebarWidth,
  maxSidebarWidth,
  panel,
  revealLabel,
  sidebarWidth,
  trashLabel,
} from '../workspace/use-layout';
import { activePath, openDoc, trackPointer } from '../workspace/use-panes';
import {
  addDir,
  addDoc,
  canDropInto,
  deleteEntryWithTrash,
  dropEntry,
  moveEntryTo,
  renameEntry,
  revealEntry,
  toggleLocked,
  togglePinned,
} from './use-project-actions';
import {
  annotationCount,
  data,
  expanded,
  expandedResources,
  refreshing,
  resourceCount,
  resourceRootExpanded,
  resourceRows,
  rows,
  toggleDirectory,
} from './use-project';

const context = ref<TreeNode | null>(null);
const contextAt = ref({ x: 0, y: 0 });
const dragging = ref<string | null>(null);
/** `''` is the project root. */
const dropTarget = ref<string | null>(null);

function showContext(event: MouseEvent, node: TreeNode) {
  context.value = node;
  contextAt.value = {
    x: Math.min(event.clientX, window.innerWidth - 196),
    y: Math.min(event.clientY, window.innerHeight - 320),
  };
  openMenu.value = 'context';
}

function contextAction(action: (node: TreeNode) => unknown) {
  const node = context.value;
  closeMenus();
  if (node) void action(node);
}

function startDrag(event: DragEvent, node: TreeNode) {
  if (node.lockSource || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  dragging.value = node.path;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', node.path);
}

function targetFor(node: TreeNode | null): string {
  if (!node) return '';
  if (node.kind === 'directory') return node.path;
  const slash = node.path.lastIndexOf('/');
  return slash < 0 ? '' : node.path.slice(0, slash);
}

function dragOver(event: DragEvent, node: TreeNode | null) {
  const source = dragging.value;
  if (!source) return;
  const target = targetFor(node);
  if (!canDropInto(source, target)) {
    dropTarget.value = null;
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTarget.value = target;
}

function drop(event: DragEvent, node: TreeNode | null) {
  event.preventDefault();
  const source = dragging.value;
  const target = targetFor(node);
  endDrag();
  if (source) void dropEntry(source, target);
}

function endDrag() {
  dragging.value = null;
  dropTarget.value = null;
}

function dropHighlighted(node: TreeNode): boolean {
  return (
    dropTarget.value !== null && dropTarget.value !== '' && targetFor(node) === dropTarget.value
  );
}

function resizeSidebar(event: PointerEvent) {
  const handle = event.currentTarget;
  if (!(handle instanceof HTMLElement)) return;
  const startX = event.clientX;
  const startWidth = sidebarWidth.value;
  trackPointer(handle, event, (next) => {
    sidebarWidth.value = clampSidebarWidth(startWidth + next.clientX - startX);
  });
}

function openResource(path: string) {
  void openProjectResource(path).catch(report);
}

function showAnnotations(kind: (typeof annotationKinds)[number]['value']) {
  annotationFilter.value = kind;
  panel.value = 'annotations';
}
</script>

<template>
  <aside
    class="project-sidebar relative flex shrink-0 flex-col bg-[#f3f6fa]"
    :style="{ width: `${sidebarWidth}px` }"
  >
    <div
      class="group absolute inset-y-0 right-0 z-10 flex w-2 touch-none cursor-col-resize items-center justify-center"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('调整侧栏宽度', 'Resize sidebar')"
      :aria-valuenow="sidebarWidth"
      :aria-valuemin="200"
      :aria-valuemax="maxSidebarWidth"
      tabindex="0"
      @pointerdown.prevent.stop="resizeSidebar"
      @keydown.left.prevent="sidebarWidth = sidebarWidth - 16"
      @keydown.right.prevent="sidebarWidth = sidebarWidth + 16"
    >
      <div
        class="h-full w-px bg-slate-300 opacity-0 group-hover:opacity-100 group-focus:opacity-100"
      />
    </div>
    <div class="sidebar-heading flex items-center justify-between px-4 pt-4 pb-2">
      <span>{{ t('项目文件', 'Project files') }}</span>
      <div class="flex gap-0.5">
        <button
          class="rounded p-1 hover:bg-slate-200"
          :title="t('新建文件夹', 'New folder')"
          @click.stop="addDir()"
        >
          <FolderPlus :size="15" />
        </button>
        <button
          class="rounded p-1 hover:bg-slate-200"
          :title="t('新建文档', 'New document')"
          @click.stop="addDoc()"
        >
          <FilePlus2 :size="15" />
        </button>
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div
        class="min-h-16 rounded-lg px-3 py-1"
        :class="dropTarget === '' ? 'bg-blue-50 ring-1 ring-blue-300 ring-inset' : ''"
        @dragover="dragOver($event, null)"
        @dragleave.self="dropTarget = null"
        @drop="drop($event, null)"
      >
        <div v-if="refreshing && rows.length === 0" class="space-y-3 px-3 py-2" role="status">
          <div v-for="line in 3" :key="line" class="h-3 animate-pulse rounded bg-slate-200/70" />
          <span class="sr-only">{{ t('正在加载项目文件', 'Loading project files') }}</span>
        </div>
        <div v-else-if="rows.length === 0" class="px-2 pt-4 pb-5 text-center">
          <img
            src="/empty-project-files.svg"
            alt=""
            class="mx-auto mb-2 h-28 w-40 object-contain"
          />
          <p class="text-xs font-medium text-slate-600">
            {{ t('这里还没有文档', 'No documents yet') }}
          </p>
          <p class="mt-1 text-[11px] leading-5 text-slate-400">
            {{ t('新建一篇，开始写作', 'Create one to start writing') }}
          </p>
        </div>
        <button
          v-for="row in rows"
          :key="row.node.path"
          :title="row.node.path"
          :draggable="!row.node.lockSource"
          :class="[
            'tree-row flex w-full items-center gap-1 rounded-md py-1.5 pr-2 text-left text-sm',
            activePath === row.node.path
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'hover:bg-slate-200/70',
            dropHighlighted(row.node) && row.node.kind === 'directory'
              ? 'ring-1 ring-blue-400 ring-inset'
              : '',
            dragging === row.node.path ? 'opacity-50' : '',
          ]"
          :style="{ paddingLeft: `${row.depth * 16 + 8}px` }"
          :aria-expanded="row.node.kind === 'directory' ? expanded.has(row.node.path) : undefined"
          @click.stop="
            row.node.kind === 'directory' ? toggleDirectory(row.node.path) : openDoc(row.node.path)
          "
          @contextmenu.prevent.stop="showContext($event, row.node)"
          @dragstart="startDrag($event, row.node)"
          @dragover.stop="dragOver($event, row.node)"
          @drop.stop="drop($event, row.node)"
          @dragend="endDrag"
        >
          <component
            :is="expanded.has(row.node.path) ? ChevronDown : ChevronRight"
            v-if="row.node.kind === 'directory'"
            :size="14"
            class="shrink-0"
          /><span v-else class="w-3.5 shrink-0" /><Folder
            v-if="row.node.kind === 'directory'"
            :size="16"
            class="shrink-0"
          /><FileText v-else :size="16" class="shrink-0" /><span class="min-w-0 flex-1 truncate">{{
            row.node.name
          }}</span
          ><Bookmark
            v-if="row.node.pinned"
            :size="12"
            fill="currentColor"
            class="shrink-0"
            :aria-label="t('已固定', 'Pinned')"
          /><LockKeyhole
            v-if="row.node.lockSource"
            :size="12"
            class="shrink-0"
            :class="row.node.lockSource === row.node.path ? '' : 'opacity-45'"
            :aria-label="
              row.node.lockSource === row.node.path
                ? t('直接锁定', 'Locked directly')
                : t(`由 ${row.node.lockSource} 锁定`, `Locked by ${row.node.lockSource}`)
            "
          />
        </button>
      </div>
      <div class="px-3 pt-3 pb-3">
        <div class="sidebar-heading px-2">{{ t('资源库', 'Resources') }}</div>
        <button
          class="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-200/70"
          :title="t('展开或收起资源库', 'Expand or collapse resources')"
          :aria-expanded="resourceRootExpanded"
          @click.stop="resourceRootExpanded = !resourceRootExpanded"
        >
          <component :is="resourceRootExpanded ? ChevronDown : ChevronRight" :size="14" />
          <Folder :size="16" class="fill-blue-600 text-blue-600" />
          <span class="min-w-0 flex-1 truncate">resources</span>
          <span class="text-xs text-slate-400">{{ resourceCount }}</span>
        </button>
        <div v-if="resourceRootExpanded">
          <p
            v-if="resourceRows.length === 0"
            class="px-4 py-2 text-[11px] leading-5 text-slate-400"
          >
            {{
              t(
                '把参考文件放进项目的 resources 文件夹，就会显示在这里。',
                'Files in the project’s resources folder appear here.',
              )
            }}
          </p>
          <div
            v-for="row in resourceRows"
            :key="row.node.path"
            class="flex items-center gap-1 rounded-md py-1 text-sm hover:bg-slate-200/70"
            :style="{ paddingLeft: `${24 + row.depth * 14}px` }"
          >
            <button
              v-if="row.node.kind === 'directory'"
              class="flex min-w-0 flex-1 items-center gap-1 text-left"
              :title="row.node.name"
              @click.stop="
                expandedResources.has(row.node.path)
                  ? expandedResources.delete(row.node.path)
                  : expandedResources.add(row.node.path)
              "
            >
              <component
                :is="expandedResources.has(row.node.path) ? ChevronDown : ChevronRight"
                :size="13"
              />
              <Folder :size="15" class="shrink-0 text-blue-600" />
              <span class="truncate">{{ row.node.name }}</span>
            </button>
            <button
              v-else
              class="flex min-w-0 flex-1 items-center gap-1 text-left"
              :title="
                t(
                  `使用系统默认程序打开 ${row.node.name}`,
                  `Open ${row.node.name} with the default app`,
                )
              "
              @click.stop="openResource(row.node.path)"
            >
              <span class="w-3" />
              <FileText :size="15" class="shrink-0" />
              <span class="min-w-0 flex-1 truncate">{{ row.node.name }}</span>
              <span class="pr-2 text-[10px] text-slate-400">{{ row.node.fileType }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="sidebar-data mx-3 mt-auto mb-3 rounded-xl px-1 pt-2 pb-1">
      <div class="sidebar-heading px-2 pb-1">{{ t('项目资料', 'Project notes') }}</div>
      <button
        class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-slate-200/70"
        :title="
          t(
            '为项目术语添加解释，正文中悬停即可查看',
            'Define project terms and hover over them in documents',
          )
        "
        @click.stop="panel = 'terms'"
      >
        <span class="flex items-center gap-1.5"
          ><BookMarked :size="14" class="text-slate-500" />{{ t('术语', 'Terms') }}</span
        ><span class="text-xs text-slate-500">{{ data.terms.length }}</span>
      </button>
      <button
        v-for="kind in annotationKinds"
        :key="kind.value"
        class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-slate-200/70"
        :title="t('选中正文后可添加标注', 'Select text in a document to add one')"
        @click.stop="showAnnotations(kind.value)"
      >
        <span class="flex items-center gap-1.5"
          ><i class="mx-[3px] h-2 w-2 rounded-full" :style="{ background: kind.color }" />{{
            kindLabel(kind.value)
          }}</span
        ><span class="text-xs text-slate-500">{{ annotationCount(kind.value) }}</span>
      </button>
    </div>
    <div
      v-if="openMenu === 'context' && context"
      class="app-menu fixed z-50 w-48"
      role="menu"
      :style="{ left: `${contextAt.x}px`, top: `${contextAt.y}px` }"
      @click.stop
    >
      <template v-if="context.kind === 'directory'">
        <button
          class="app-menu-item"
          role="menuitem"
          @click="contextAction((node) => addDoc(node.path))"
        >
          {{ t('新建文档', 'New document') }}
        </button>
        <button
          class="app-menu-item"
          role="menuitem"
          @click="contextAction((node) => addDir(node.path))"
        >
          {{ t('新建文件夹', 'New folder') }}
        </button>
        <div class="app-menu-divider" />
      </template>
      <template v-else>
        <button
          class="app-menu-item"
          role="menuitem"
          @click="contextAction((node) => openDoc(node.path))"
        >
          {{ t('打开', 'Open') }}
        </button>
        <button class="app-menu-item" role="menuitem" @click="contextAction(togglePinned)">
          {{ context.pinned ? t('取消固定', 'Unpin') : t('固定文档', 'Pin document') }}
        </button>
      </template>
      <button
        class="app-menu-item"
        role="menuitem"
        :disabled="!!context.lockSource && context.lockSource !== context.path"
        @click="contextAction(toggleLocked)"
      >
        {{ context.lockSource === context.path ? t('解锁', 'Unlock') : t('锁定', 'Lock') }}
      </button>
      <button
        class="app-menu-item"
        role="menuitem"
        @click="contextAction((node) => revealEntry(node.path))"
      >
        {{ revealLabel }}
      </button>
      <div class="app-menu-divider" />
      <button
        class="app-menu-item"
        role="menuitem"
        :disabled="!!context.lockSource"
        @click="contextAction(renameEntry)"
      >
        {{ t('重命名…', 'Rename…') }}
      </button>
      <button
        class="app-menu-item"
        role="menuitem"
        :disabled="!!context.lockSource"
        @click="contextAction((node) => moveEntryTo(node))"
      >
        {{ t('移动到…', 'Move to…') }}
      </button>
      <button
        class="app-menu-item is-danger"
        role="menuitem"
        :disabled="!!context.lockSource"
        @click="contextAction(deleteEntryWithTrash)"
      >
        {{ t(`移到${trashLabel}`, `Move to ${trashLabel}`) }}
      </button>
    </div>
  </aside>
</template>
