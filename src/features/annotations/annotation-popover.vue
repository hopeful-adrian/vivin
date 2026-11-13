<script setup lang="ts">
import { Pencil, Trash2 } from '@lucide/vue';
import { defineAsyncComponent, nextTick } from 'vue';
import { locale, t } from '../../lib/i18n';
import { usePreferences } from '../settings/use-preferences';
import { openReference } from '../workspace/use-panes';
import {
  annotationDraft,
  annotationEditing,
  annotationEditSize,
  annotationPopoverAt,
  annotationPopoverSize,
  annotationSaving,
  keepAnnotationPopover,
  kindColor,
  kindLabel,
  positionAnnotationPopover,
  removeAnnotation,
  scheduleHideAnnotationPopover,
  selectedAnnotation,
  startAnnotationEdit,
  updateAnnotation,
} from './use-annotations';

const AnnotationMarkdown = defineAsyncComponent(
  () => import('../../components/annotation-markdown.vue'),
);
const { theme } = usePreferences();
</script>

<template>
  <div
    v-if="selectedAnnotation"
    id="vivin-annotation-popover"
    class="fixed z-50 flex w-max flex-col overflow-hidden rounded-lg bg-white text-sm shadow-xl ring-1 ring-slate-200/70"
    :style="{
      left: `${annotationPopoverAt.x}px`,
      top: `${annotationPopoverAt.y}px`,
      width: annotationEditing ? `${annotationEditSize.width}px` : undefined,
      height: annotationEditing ? `${annotationEditSize.height}px` : undefined,
      maxWidth: `${annotationPopoverSize.width}px`,
      maxHeight: `${annotationPopoverSize.height}px`,
    }"
    role="group"
    :aria-label="kindLabel(selectedAnnotation.kind)"
    @mouseenter="keepAnnotationPopover"
    @mouseleave="scheduleHideAnnotationPopover"
    @click.stop
  >
    <div class="flex shrink-0 items-center justify-between gap-3 px-2 pt-1">
      <span
        class="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600"
      >
        <span
          aria-hidden="true"
          class="h-1.5 w-1.5 shrink-0 rounded-full"
          :style="{ background: kindColor(selectedAnnotation.kind) }"
        />
        {{ kindLabel(selectedAnnotation.kind) }}
      </span>
      <div class="flex shrink-0 gap-1">
        <button
          v-if="!annotationEditing"
          class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
          :title="t('编辑说明', 'Edit note')"
          @click.stop="startAnnotationEdit"
        >
          <Pencil :size="15" />
        </button>
        <button
          class="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          :title="t('删除标注', 'Delete annotation')"
          @click.stop="removeAnnotation(selectedAnnotation)"
        >
          <Trash2 :size="15" />
        </button>
      </div>
    </div>
    <div v-if="!annotationEditing" class="min-h-0 overflow-auto">
      <AnnotationMarkdown
        :key="selectedAnnotation.id"
        :markdown="selectedAnnotation.note || t('无说明', 'No note')"
        :document-path="selectedAnnotation.document"
        :locale="locale"
        :theme="theme"
        @ready="nextTick(positionAnnotationPopover)"
        @open-reference="openReference(selectedAnnotation.document, $event)"
      />
    </div>
    <div v-else class="flex min-h-0 flex-1 flex-col p-3">
      <textarea
        id="vivin-annotation-note"
        v-model="annotationDraft"
        class="min-h-0 w-full flex-1 resize-none rounded-lg bg-slate-50 p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-blue-200"
        rows="10"
        :aria-label="t('标注说明', 'Annotation note')"
        @keydown.esc.stop="annotationEditing = false"
      />
      <div class="mt-2 flex shrink-0 justify-end gap-2 text-xs">
        <button
          class="rounded-md px-2.5 py-1.5 text-slate-500 hover:bg-slate-100"
          @click.stop="annotationEditing = false"
        >
          {{ t('取消', 'Cancel') }}
        </button>
        <button
          class="rounded-md bg-blue-600 px-2.5 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
          :disabled="annotationSaving"
          @click.stop="updateAnnotation(selectedAnnotation)"
        >
          {{ t('保存', 'Save') }}
        </button>
      </div>
    </div>
  </div>
</template>
