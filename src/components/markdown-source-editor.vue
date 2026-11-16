<script setup lang="ts">
import { markdown } from '@codemirror/lang-markdown';
import { indentUnit } from '@codemirror/language';
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Transaction,
} from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AnnotationMark } from '../lib/annotation-anchor';
import type { SearchRange } from '../lib/document-search';
import { minimalDocumentChange } from '../lib/document-change';
import { importImage, type AnnotationKind } from '../lib/project-api';

export interface SourceEditorOptions {
  lineNumbers: boolean;
  lineWrapping: boolean;
  indentWidth: number;
  highlightCurrentLine: boolean;
  typewriterScroll: boolean;
}

const props = defineProps<{
  modelValue: string;
  documentPath: string;
  options: SourceEditorOptions;
  readonly?: boolean;
  annotations?: AnnotationMark[];
  locale?: 'zh' | 'en';
  searchMatches?: SearchRange[];
  activeSearchOffset?: number;
  revealRequest?: { offset: number; length: number; token: number };
}>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  error: [message: string];
  'annotation-request': [kind: AnnotationKind, selection: { quote: string; offset: number }];
}>();
const container = ref<HTMLDivElement>();
const selectionToolbar = ref<{ quote: string; offset: number; x: number; y: number } | null>(null);
let editor: EditorView | undefined;
let applyingExternalChange = false;
let resolveReady: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  resolveReady = resolve;
});
const readonlyCompartment = new Compartment();
const wrappingCompartment = new Compartment();
const indentCompartment = new Compartment();
const updateSearch = StateEffect.define<null>();
const updateAnnotations = StateEffect.define<AnnotationMark[]>();

async function insertImage(file: File, position: number) {
  try {
    const path = await importImage(props.documentPath, file);
    if (!editor) return;
    const at = Math.min(position, editor.state.doc.length);
    editor.dispatch({
      changes: {
        from: at,
        insert: `![${file.name.split('[').join('').split(']').join('')}](${path})`,
      },
    });
  } catch (error) {
    emit('error', String(error));
  }
}

function buildDecorations(marks: AnnotationMark[], documentLength: number): DecorationSet {
  return Decoration.set(
    marks
      .filter((mark) => mark.offset >= 0 && mark.offset + mark.length <= documentLength)
      .map((mark) =>
        Decoration.mark({
          class: `vivin-annotation vivin-annotation-${mark.kind}`,
          'data-annotation-id': mark.id,
        }).range(mark.offset, mark.offset + mark.length),
      ),
    true,
  );
}

const annotationsField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(props.annotations ?? [], state.doc.length),
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(updateAnnotations))
        return buildDecorations(effect.value, transaction.state.doc.length);
    return transaction.docChanged
      ? buildDecorations(props.annotations ?? [], transaction.state.doc.length)
      : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function searchDecorations(documentLength: number): DecorationSet {
  return Decoration.set(
    (props.searchMatches ?? [])
      .filter((match) => match.length > 0 && match.offset + match.length <= documentLength)
      .map((match) =>
        Decoration.mark({
          class:
            match.offset === props.activeSearchOffset
              ? 'vivin-search-match vivin-search-active'
              : 'vivin-search-match',
        }).range(match.offset, match.offset + match.length),
      ),
    true,
  );
}
const searchField = StateField.define<DecorationSet>({
  create: (state) => searchDecorations(state.doc.length),
  update(value, transaction) {
    if (transaction.effects.some((effect) => effect.is(updateSearch))) {
      return searchDecorations(transaction.state.doc.length);
    }
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
watch(
  () => [props.searchMatches, props.activeSearchOffset],
  () => {
    editor?.dispatch({ effects: updateSearch.of(null) });
  },
  { flush: 'post' },
);

onMounted(() => {
  if (!container.value) {
    resolveReady();
    return;
  }
  editor = new EditorView({
    parent: container.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        markdown(),
        wrappingCompartment.of(wrapping(props.options.lineWrapping)),
        indentCompartment.of(indentation(props.options.indentWidth)),
        readonlyCompartment.of(EditorView.editable.of(!props.readonly)),
        annotationsField,
        searchField,
        EditorView.domEventHandlers({
          paste(event, view) {
            if (props.readonly) return false;
            const file = [...(event.clipboardData?.files ?? [])].find((item) =>
              item.type.startsWith('image/'),
            );
            if (!file) return false;
            event.preventDefault();
            void insertImage(file, view.state.selection.main.from);
            return true;
          },
          drop(event, view) {
            if (props.readonly) return false;
            const file = [...(event.dataTransfer?.files ?? [])].find((item) =>
              item.type.startsWith('image/'),
            );
            if (!file) return false;
            event.preventDefault();
            const at =
              view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
              view.state.selection.main.from;
            void insertImage(file, at);
            return true;
          },
        }),
        keymap.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternalChange) {
            emit('update:modelValue', update.state.doc.toString());
          }
          if (props.options.typewriterScroll && update.transactions.some(movesCaretByKeyboard))
            centerCaret();
          const selection = update.state.selection.main;
          if (props.readonly || selection.empty || !container.value) {
            selectionToolbar.value = null;
            return;
          }
          const coordinates = update.view.coordsAtPos(selection.from);
          if (!coordinates) return;
          selectionToolbar.value = {
            quote: update.state.doc.sliceString(selection.from, selection.to),
            offset: selection.from,
            x: Math.max(8, Math.min(coordinates.left, window.innerWidth - 300)),
            y: Math.max(60, coordinates.top - 48),
          };
        }),
      ],
    }),
  });
  resolveReady();
});

watch(
  () => props.modelValue,
  (value) => {
    if (!editor || editor.state.doc.toString() === value) return;
    applyingExternalChange = true;
    editor.dispatch({ changes: minimalDocumentChange(editor.state.doc.toString(), value) });
    applyingExternalChange = false;
  },
);

watch(
  () => props.readonly,
  (value) =>
    editor?.dispatch({ effects: readonlyCompartment.reconfigure(EditorView.editable.of(!value)) }),
);

function wrapping(enabled: boolean) {
  return enabled ? EditorView.lineWrapping : [];
}

function indentation(width: number) {
  return [indentUnit.of(' '.repeat(width)), EditorState.tabSize.of(width)];
}

function movesCaretByKeyboard(transaction: Transaction): boolean {
  if (transaction.isUserEvent('select.pointer')) return false;
  return ['input', 'delete', 'undo', 'redo', 'select', 'move'].some((event) =>
    transaction.isUserEvent(event),
  );
}

let centerFrame = 0;
function centerCaret() {
  cancelAnimationFrame(centerFrame);
  centerFrame = requestAnimationFrame(() => {
    if (!editor) return;
    editor.dispatch({
      effects: EditorView.scrollIntoView(editor.state.selection.main.head, { y: 'center' }),
    });
  });
}

watch(
  () => props.options.lineWrapping,
  (value) => editor?.dispatch({ effects: wrappingCompartment.reconfigure(wrapping(value)) }),
);

watch(
  () => props.options.indentWidth,
  (value) => editor?.dispatch({ effects: indentCompartment.reconfigure(indentation(value)) }),
);

watch(
  () => props.annotations,
  (marks) => editor?.dispatch({ effects: updateAnnotations.of(marks ?? []) }),
  { deep: true },
);

watch(
  () => props.revealRequest,
  (request) => {
    if (request) void reveal(request.offset, request.length);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  cancelAnimationFrame(centerFrame);
  resolveReady();
  editor?.destroy();
  editor = undefined;
});

async function reveal(offset: number, length = 0, focus = true) {
  await ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (!editor) return;
  const anchor = Math.max(0, Math.min(offset, editor.state.doc.length));
  const head = Math.max(anchor, Math.min(anchor + length, editor.state.doc.length));
  editor.dispatch({
    ...(focus ? { selection: { anchor, head } } : {}),
    effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
  });
  if (focus) editor.focus();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (!editor) return;
  // CodeMirror and the surrounding pane can both be scroll containers, depending
  // on the active layout. Center the target in whichever one owns the overflow.
  const targetTop = editor.lineBlockAt(anchor).top;
  editor.scrollDOM.scrollTop = Math.max(0, targetTop - editor.scrollDOM.clientHeight / 2);
  if (container.value) {
    container.value.scrollTop = Math.max(0, targetTop - container.value.clientHeight / 2);
  }
}

function selectedText(): { quote: string; offset: number } | null {
  if (!editor) return null;
  const selection = editor.state.selection.main;
  if (selection.empty) return null;
  return {
    quote: editor.state.doc.sliceString(selection.from, selection.to),
    offset: selection.from,
  };
}

function replaceMatches(matches: SearchRange[], replacement: string) {
  if (!editor || props.readonly) return;
  editor.dispatch({
    changes: matches.map((match) => ({
      from: match.offset,
      to: match.offset + match.length,
      insert: replacement,
    })),
  });
}

defineExpose({ reveal, selectedText, replaceMatches, focus: () => editor?.focus() });
</script>

<template>
  <div
    ref="container"
    class="source-editor relative h-full overflow-auto text-sm"
    :class="{
      'hide-line-numbers': !options.lineNumbers,
      'hide-current-line': !options.highlightCurrentLine,
      'is-typewriter': options.typewriterScroll,
    }"
  >
    <div
      v-if="selectionToolbar"
      class="selection-annotation-toolbar fixed z-30 flex gap-1 rounded-xl bg-white p-1.5 shadow-lg"
      :style="{ left: `${selectionToolbar.x}px`, top: `${selectionToolbar.y}px` }"
      @pointerdown.prevent
    >
      <button
        v-for="kind in ['todo', 'comment', 'question', 'error'] as const"
        :key="kind"
        class="rounded-md px-2 py-1 text-xs hover:bg-slate-100"
        :title="
          {
            todo: locale === 'en' ? 'Todo' : '待办',
            comment: locale === 'en' ? 'Comment' : '批注',
            question: locale === 'en' ? 'Question' : '疑问',
            error: locale === 'en' ? 'Error' : '错误',
          }[kind]
        "
        @click.stop="
          emit('annotation-request', kind, {
            quote: selectionToolbar!.quote,
            offset: selectionToolbar!.offset,
          });
          selectionToolbar = null;
        "
      >
        {{
          {
            todo: locale === 'en' ? 'Todo' : '待办',
            comment: locale === 'en' ? 'Comment' : '批注',
            question: locale === 'en' ? 'Question' : '疑问',
            error: locale === 'en' ? 'Error' : '错误',
          }[kind]
        }}
      </button>
    </div>
  </div>
</template>

<style>
.source-editor .cm-editor {
  height: 100%;
  background: transparent;
}

.source-editor .cm-scroller {
  padding: 28px clamp(12px, 3vw, 40px) 80px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  line-height: 1.7;
}

.source-editor .cm-content {
  padding: 4px 0;
}
.source-editor .cm-gutters {
  border: 0;
  background: transparent;
  color: #94a3b8;
}
.source-editor .cm-activeLine,
.source-editor .cm-activeLineGutter {
  background: #f1f5fb;
}
.source-editor .cm-line {
  padding-inline: 12px;
}

.source-editor .cm-focused {
  outline: none;
}
.source-editor.hide-line-numbers .cm-lineNumbers {
  display: none !important;
}
.app-shell .source-editor.hide-current-line .cm-activeLine,
.app-shell .source-editor.hide-current-line .cm-activeLineGutter {
  background: transparent;
}
.source-editor.is-typewriter .cm-content {
  padding-bottom: 45vh;
}
</style>
