<script setup lang="ts">
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { editorViewCtx, parserCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { uploadConfig } from '@milkdown/kit/plugin/upload';
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { preserveSource, sourceBlock } from '../features/editor/preserve-source';
import type { AnnotationMark } from '../lib/annotation-anchor';
import { markdownHeadings } from '../lib/markdown-outline';
import type { AnnotationKind } from '../lib/project-api';
import { equivalentMarkdown } from '../lib/markdown-roundtrip';
import {
  renderedTextMap,
  renderedRanges,
  nearestRenderedPosition,
  type RenderedTextRun,
} from '../lib/rendered-text-map';
import { replaceDocumentMatches, type SearchRange } from '../lib/document-search';
import {
  getCachedMermaidPreview,
  renderMermaidPreview,
  renderMermaidSvg,
} from '../lib/mermaid-preview';
import { importImage, readProjectImage } from '../lib/project-api';
import LoadingState from './loading-state.vue';
import DiagramViewer from './diagram-viewer.vue';

const props = defineProps<{
  modelValue: string;
  documentPath: string;
  readonly?: boolean;
  annotations?: AnnotationMark[];
  searchMatches?: SearchRange[];
  activeSearchOffset?: number;
  terms?: { id: string; offset: number; quote: string }[];
  locale?: 'zh' | 'en';
  theme?: 'light' | 'dark';
  embedded?: boolean;
  deferMermaid?: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  incompatible: [];
  error: [message: string];
  'annotation-request': [kind: AnnotationKind, selection: { quote: string; offset: number }];
  'open-reference': [href: string];
  ready: [];
}>();

const container = ref<HTMLDivElement>();
const editorReady = ref(false);
const expandedDiagram = ref('');
const editorFailed = ref(false);
let crepe: Crepe | undefined;
let applyingExternalChange = true;
let editorMarkdown = '';
let disposed = false;
let pendingChanges = false;
let changeTimer: ReturnType<typeof setTimeout> | undefined;
let resolveReady: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  resolveReady = resolve;
});
const imageCache = new Map<string, Promise<string>>();
const mermaidRequests = new Map<
  string,
  { content: string; applyPreview: (value: null | string | HTMLElement) => void }
>();
let nextMermaidRequestId = 0;
const activeMermaidPreviews = new Map<(value: null | string | HTMLElement) => void, string>();
watch(
  () => props.theme,
  () => {
    for (const [apply, content] of activeMermaidPreviews) {
      void renderMermaidSvg(content, props.theme === 'dark')
        .then((svg) => {
          if (!disposed) apply(svg);
        })
        .catch(() => {});
    }
  },
  { flush: 'post' },
);

function mermaidPreview(
  language: string,
  content: string,
  applyPreview: (value: null | string | HTMLElement) => void,
): null | string | void {
  if (language.toLowerCase() !== 'mermaid' || !content.trim()) return null;
  activeMermaidPreviews.set(applyPreview, content);
  if (!props.deferMermaid && props.modelValue.length < 100_000)
    return renderMermaidPreview(language, content, applyPreview);
  const cached = getCachedMermaidPreview(content);
  if (cached) return cached;
  const id = String(++nextMermaidRequestId);
  mermaidRequests.set(id, { content, applyPreview });
  if (mermaidRequests.size > 512) {
    const oldest = mermaidRequests.keys().next().value;
    if (oldest !== undefined) mermaidRequests.delete(oldest);
  }
  const label = props.locale === 'en' ? 'Show flowchart' : '显示流程图';
  return `<button type="button" class="vivin-mermaid-load" data-vivin-mermaid-id="${id}">${label}</button>`;
}

function handleMermaidClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('[data-vivin-mermaid-id]');
  if (!button || !container.value?.contains(button)) return;
  event.preventDefault();
  event.stopPropagation();
  const id = button.dataset.vivinMermaidId;
  if (!id) return;
  const request = mermaidRequests.get(id);
  if (!request) return;
  mermaidRequests.delete(id);
  button.disabled = true;
  button.textContent = props.locale === 'en' ? 'Rendering flowchart…' : '正在生成流程图…';
  const cached = renderMermaidPreview('mermaid', request.content, request.applyPreview);
  if (typeof cached === 'string') request.applyPreview(cached);
}

function openLink(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (!link || !container.value?.contains(link)) return;
  event.preventDefault();
  event.stopPropagation();
  emit('open-reference', link.getAttribute('href') ?? '');
}

function handleRenderedClick(event: MouseEvent) {
  handleMermaidClick(event);
  const target =
    event.target instanceof Element
      ? event.target.closest<SVGSVGElement>('svg[id^="vivin-mermaid-"]')
      : null;
  if (target) {
    event.preventDefault();
    event.stopPropagation();
    expandedDiagram.value = target.outerHTML;
  }
  if (!event.defaultPrevented) openLink(event);
}

function keepHorizontalPosition() {
  if (container.value?.scrollLeft) container.value.scrollLeft = 0;
}

let indexedDocument: object | undefined;
let indexedSource = '';
let textMapping = new Map<number, number>();
function sourceMapping(state: EditorState) {
  if (indexedDocument !== state.doc || indexedSource !== props.modelValue) {
    const runs: RenderedTextRun[] = [];
    state.doc.descendants((node, position) => {
      if (node.isText && node.text) runs.push({ text: node.text, position });
      if (node.type.name === 'math_inline' && typeof node.attrs.value === 'string') {
        runs.push({ text: node.attrs.value, position, atomic: true });
      }
    });
    textMapping = renderedTextMap(props.modelValue, runs);
    indexedDocument = state.doc;
    indexedSource = props.modelValue;
  }
  return textMapping;
}
async function reveal(offset: number, length = 0): Promise<boolean> {
  await ready;
  if (!crepe || disposed) return false;
  return crepe.editor.action((context) => {
    const view = context.get(editorViewCtx);
    const mapping = sourceMapping(view.state);
    const position =
      renderedRanges(mapping, offset, Math.max(1, length))[0]?.from ??
      nearestRenderedPosition(mapping, offset);
    if (position === undefined) return false;
    const dom = view.domAtPos(position).node;
    const element = dom instanceof Element ? dom : dom.parentElement;
    element?.scrollIntoView({ block: 'center', inline: 'nearest' });
    return Boolean(element);
  });
}
function replaceMatches(matches: SearchRange[], replacement: string) {
  if (props.readonly || !crepe) return;
  flush();
  const value = replaceDocumentMatches(props.modelValue, matches, replacement);
  applyMarkdown(value, true);
  emit('update:modelValue', value);
}

async function revealAnnotation(id: string): Promise<boolean> {
  await ready;
  const node = [
    ...(container.value?.querySelectorAll<HTMLElement>('[data-annotation-id]') ?? []),
  ].find((element) => element.dataset.annotationId === id);
  if (!node) return false;
  node.scrollIntoView({ block: 'center', inline: 'nearest' });
  return true;
}

async function revealHeading(offset: number): Promise<boolean> {
  await ready;
  const rawRanges: { start: number; end: number; element: HTMLElement }[] = [];
  let from = 0;
  for (const element of container.value?.querySelectorAll<HTMLElement>('[data-vivin-source]') ??
    []) {
    const text = element.textContent ?? '';
    const start = props.modelValue.indexOf(text, from);
    if (start < 0) continue;
    from = start + text.length;
    rawRanges.push({ start, end: from, element });
  }
  const raw = rawRanges.find((range) => offset >= range.start && offset < range.end);
  if (raw) {
    raw.element.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  }
  const index = markdownHeadings(props.modelValue)
    .filter(
      (heading) =>
        !rawRanges.some((range) => heading.offset >= range.start && heading.offset < range.end),
    )
    .findIndex((heading) => heading.offset === offset);
  if (index < 0) return false;
  const node = container.value?.querySelectorAll<HTMLElement>(
    '.ProseMirror > h1, .ProseMirror > h2, .ProseMirror > h3, .ProseMirror > h4, .ProseMirror > h5, .ProseMirror > h6',
  )[index];
  if (!node) return false;
  node.scrollIntoView({ block: 'center', inline: 'nearest' });
  return true;
}

function flush() {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = undefined;
  if (!pendingChanges || !crepe || applyingExternalChange || disposed) return;
  pendingChanges = false;
  const markdown = crepe.getMarkdown();
  editorMarkdown = markdown;
  if (markdown !== props.modelValue) emit('update:modelValue', markdown);
}
const documentSyncPlugin = $prose(
  () =>
    new Plugin({
      view: () => ({
        update(view, previous) {
          if (applyingExternalChange || previous.doc.eq(view.state.doc)) return;
          pendingChanges = true;
          if (changeTimer) clearTimeout(changeTimer);
          changeTimer = setTimeout(flush, 120);
        },
      }),
    }),
);

defineExpose({
  reveal,
  revealAnnotation,
  revealHeading,
  flush,
  replaceMatches,
  focus: () => crepe?.editor.action((context) => context.get(editorViewCtx).focus()),
});

async function proxyImage(url: string): Promise<string> {
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  let cached = imageCache.get(url);
  if (!cached) {
    cached = readProjectImage(props.documentPath, decodeURI(url));
    imageCache.set(url, cached);
  }
  try {
    return await cached;
  } catch (error) {
    emit('error', String(error));
    return '';
  }
}

async function uploadImage(file: File): Promise<string> {
  try {
    return await importImage(props.documentPath, file);
  } catch (error) {
    emit('error', String(error));
    throw error;
  }
}

function occurrences(text: string, quote: string): number[] {
  const offsets: number[] = [];
  let from = 0;
  while (from < text.length) {
    const next = text.indexOf(quote, from);
    if (next < 0) break;
    offsets.push(next);
    from = next + Math.max(1, quote.length);
  }
  return offsets;
}
const annotationIcons: Record<AnnotationKind, string> = {
  todo: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4 10-10" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  comment:
    '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  question:
    '<svg viewBox="0 0 24 24"><path d="M9 9a3 3 0 1 1 5 2.2c-1.3 1-2 1.5-2 3M12 18h.01" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"/></svg>',
  error:
    '<svg viewBox="0 0 24 24"><path d="M12 4 2 21h20L12 4Zm0 6v5m0 3h.01" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"/></svg>',
};
const markRefreshKey = new PluginKey<DecorationSet>('vivin-marks');
function requestAnnotation(kind: AnnotationKind, context: Ctx) {
  flush();
  const view = context.get(editorViewCtx);
  const { from, to } = view.state.selection;
  const quote = view.state.doc.textBetween(from, to, '', '');
  if (!quote) return;
  const visible = view.state.doc.textBetween(0, view.state.doc.content.size, '', '');
  const prefix = view.state.doc.textBetween(0, from, '', '');
  const rank = occurrences(prefix, quote).length;
  const raw = occurrences(editorMarkdown || props.modelValue, quote);
  const matches = occurrences(visible, quote);
  const offset = raw.length === matches.length ? raw[rank] : raw.length === 1 ? raw[0] : undefined;
  if (offset === undefined) {
    emit(
      'error',
      props.locale === 'en'
        ? 'Cannot locate this selection. Try source mode.'
        : '无法准确定位选中文字，请切换原文模式重试',
    );
    return;
  }
  emit('annotation-request', kind, { quote, offset });
}

const annotationPlugin = $prose(() => {
  const buildDecorations = (state: EditorState): DecorationSet => {
    const mapping = sourceMapping(state);
    const decorations: ReturnType<typeof Decoration.inline>[] = [];
    for (const mark of props.annotations ?? []) {
      for (const range of renderedRanges(mapping, mark.offset, mark.length)) {
        decorations.push(
          Decoration.inline(range.from, range.to, {
            class: `vivin-annotation vivin-annotation-${mark.kind}`,
            'data-annotation-id': mark.id,
          }),
        );
      }
    }
    for (const mark of props.terms ?? []) {
      for (const range of renderedRanges(mapping, mark.offset, mark.quote.length)) {
        if (state.doc.resolve(range.from).parent.type.name === 'heading') continue;
        decorations.push(
          Decoration.inline(range.from, range.to, {
            class: 'vivin-term',
            'data-term-id': mark.id,
            'data-term-offset': String(mark.offset),
          }),
        );
      }
    }
    const highlightedBlocks = new Map<number, { to: number; className: string }>();
    for (const match of props.searchMatches ?? []) {
      const className =
        match.offset === props.activeSearchOffset
          ? 'vivin-search-match vivin-search-active'
          : 'vivin-search-match';
      const ranges = renderedRanges(mapping, match.offset, match.length);
      for (const range of ranges) {
        decorations.push(Decoration.inline(range.from, range.to, { class: className }));
      }
      const position = ranges[0]?.from ?? nearestRenderedPosition(mapping, match.offset);
      if (position === undefined) continue;
      const resolved = state.doc.resolve(position);
      // Code blocks use their own CodeMirror node view; highlight the block as
      // well so a match stays visible while a Mermaid/formula preview is shown.
      if (resolved.depth && (!ranges.length || resolved.parent.type.name === 'code_block')) {
        const from = resolved.before();
        const previous = highlightedBlocks.get(from);
        if (!previous || match.offset === props.activeSearchOffset) {
          highlightedBlocks.set(from, { to: resolved.after(), className });
        }
      }
    }
    for (const [from, block] of highlightedBlocks) {
      decorations.push(Decoration.node(from, block.to, { class: block.className }));
    }
    return DecorationSet.create(state.doc, decorations);
  };
  return new Plugin<DecorationSet>({
    key: markRefreshKey,
    state: {
      init: (_config, state) => buildDecorations(state),
      apply(transaction, decorations, _oldState, newState) {
        if (transaction.getMeta(markRefreshKey)) return buildDecorations(newState);
        return transaction.docChanged
          ? decorations.map(transaction.mapping, newState.doc)
          : decorations;
      },
    },
    props: {
      nodeViews: {
        image(node) {
          const image = document.createElement('img');
          const apply = (src: string, alt: string) => {
            image.alt = alt;
            void proxyImage(src).then((url) => {
              image.src = url;
            });
          };
          apply(String(node.attrs.src ?? ''), String(node.attrs.alt ?? ''));
          return {
            dom: image,
            update(next) {
              if (next.type !== node.type) return false;
              apply(String(next.attrs.src ?? ''), String(next.attrs.alt ?? ''));
              return true;
            },
            ignoreMutation: () => true,
          };
        },
      },
      decorations: (state) => markRefreshKey.getState(state) ?? DecorationSet.empty,
    },
  });
});

onMounted(async () => {
  let initializing: Crepe | undefined;
  try {
    if (!container.value) return;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (disposed) return;
    const instance = new Crepe({
      root: container.value,
      defaultValue: props.modelValue,
      features: { [CrepeFeature.ImageBlock]: false },
      featureConfigs: {
        [CrepeFeature.CodeMirror]: {
          renderPreview: mermaidPreview,
          previewOnlyByDefault: true,
          previewToggleText: (previewOnlyMode) =>
            previewOnlyMode
              ? props.locale === 'en'
                ? 'Edit code'
                : '编辑代码'
              : props.locale === 'en'
                ? 'Show preview'
                : '显示预览',
        },
        [CrepeFeature.Placeholder]: {
          text: props.locale === 'en' ? 'Start writing…' : '开始写作…',
        },
        [CrepeFeature.LinkTooltip]: {
          editButton: props.locale === 'en' ? 'Edit link' : '编辑链接',
          removeButton: props.locale === 'en' ? 'Remove link' : '移除链接',
          confirmButton: props.locale === 'en' ? 'Confirm' : '确定',
          inputPlaceholder: props.locale === 'en' ? 'Paste a link…' : '粘贴链接…',
        },
        [CrepeFeature.BlockEdit]: {
          textGroup: {
            label: props.locale === 'en' ? 'Text' : '文本',
            text: { label: props.locale === 'en' ? 'Text' : '正文' },
            h1: { label: props.locale === 'en' ? 'Heading 1' : '一级标题' },
            h2: { label: props.locale === 'en' ? 'Heading 2' : '二级标题' },
            h3: { label: props.locale === 'en' ? 'Heading 3' : '三级标题' },
            h4: { label: props.locale === 'en' ? 'Heading 4' : '四级标题' },
            h5: { label: props.locale === 'en' ? 'Heading 5' : '五级标题' },
            h6: { label: props.locale === 'en' ? 'Heading 6' : '六级标题' },
            quote: { label: props.locale === 'en' ? 'Quote' : '引用' },
            divider: { label: props.locale === 'en' ? 'Divider' : '分割线' },
          },
          listGroup: {
            label: props.locale === 'en' ? 'Lists' : '列表',
            bulletList: { label: props.locale === 'en' ? 'Bullet list' : '无序列表' },
            orderedList: { label: props.locale === 'en' ? 'Numbered list' : '有序列表' },
            taskList: { label: props.locale === 'en' ? 'Task list' : '任务列表' },
          },
          advancedGroup: {
            label: props.locale === 'en' ? 'Advanced' : '更多内容',
            image: { label: props.locale === 'en' ? 'Image' : '图片' },
            codeBlock: { label: props.locale === 'en' ? 'Code block' : '代码块' },
            table: { label: props.locale === 'en' ? 'Table' : '表格' },
            math: { label: props.locale === 'en' ? 'Math' : '公式' },
          },
        },
        [CrepeFeature.Toolbar]: {
          boldLabel: props.locale === 'en' ? 'Bold' : '加粗',
          italicLabel: props.locale === 'en' ? 'Italic' : '斜体',
          strikethroughLabel: props.locale === 'en' ? 'Strikethrough' : '删除线',
          codeLabel: props.locale === 'en' ? 'Inline code' : '行内代码',
          latexLabel: props.locale === 'en' ? 'Inline math' : '行内公式',
          linkLabel: props.locale === 'en' ? 'Link' : '链接',
          buildToolbar(builder) {
            const group = builder.addGroup(
              'annotations',
              props.locale === 'en' ? 'Annotations' : '标注',
            );
            for (const kind of ['todo', 'comment', 'question', 'error'] as const) {
              const labels = {
                todo: ['待办', 'Todo'],
                comment: ['批注', 'Comment'],
                question: ['疑问', 'Question'],
                error: ['错误', 'Error'],
              };
              group.addItem(kind, {
                icon: annotationIcons[kind],
                label: labels[kind][props.locale === 'en' ? 1 : 0],
                active: () => false,
                onRun: (context) => requestAnnotation(kind, context),
              });
            }
          },
        },
      },
    });
    initializing = instance;
    instance.editor.config((context) => {
      context.update(uploadConfig.key, (previous) => ({
        ...previous,
        uploader: async (files, schema) => {
          const image = schema.nodes.image;
          if (!image) return [];
          const uploaded = await Promise.all(
            Array.from(files)
              .filter((file) => file.type.startsWith('image/'))
              .map(async (file) =>
                image.createAndFill({ src: await uploadImage(file), alt: file.name }),
              ),
          );
          return uploaded.filter((node) => node !== null);
        },
      }));
    });
    instance.editor
      .use(preserveSource)
      .use(sourceBlock)
      .use(annotationPlugin)
      .use(documentSyncPlugin);
    await instance.create();
    if (disposed) {
      await instance.destroy();
      return;
    }
    const roundtrip = instance.getMarkdown();
    editorMarkdown = roundtrip;
    if (!equivalentMarkdown(roundtrip, props.modelValue)) {
      instance.editor.action((context) => {
        const view = context.get(editorViewCtx);
        const schema = context.get(schemaCtx);
        const raw = sourceBlock
          .type(context)
          .create(null, props.modelValue ? schema.text(props.modelValue) : undefined);
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, raw));
      });
      editorMarkdown = instance.getMarkdown();
    }
    instance.setReadonly(Boolean(props.readonly));
    crepe = instance;
    applyingExternalChange = false;
    editorReady.value = true;
    emit('ready');
  } catch (error) {
    await initializing?.destroy().catch(() => {});
    editorFailed.value = true;
    emit('error', String(error));
    emit('incompatible');
  } finally {
    resolveReady();
  }
});

function applyMarkdown(value: string, addToHistory = false) {
  if (!crepe || editorMarkdown === value) return;
  const scrollTop = container.value?.scrollTop ?? 0;
  if (changeTimer) clearTimeout(changeTimer);
  pendingChanges = false;
  applyingExternalChange = true;
  crepe.editor.action((context) => {
    const view = context.get(editorViewCtx);
    let doc = context.get(parserCtx)(value);
    if (!doc) return;
    if (!equivalentMarkdown(context.get(serializerCtx)(doc), value)) {
      const schema = context.get(schemaCtx);
      const raw = sourceBlock.type(context).create(null, value ? schema.text(value) : undefined);
      doc = schema.topNodeType.create(null, raw);
    }
    const start = view.state.doc.content.findDiffStart(doc.content);
    if (start === null) return;
    const end = view.state.doc.content.findDiffEnd(doc.content);
    let endBefore = end?.a ?? start;
    let endAfter = end?.b ?? start;
    const overlap = start - Math.min(endBefore, endAfter);
    if (overlap > 0) {
      endBefore += overlap;
      endAfter += overlap;
    }
    view.dispatch(
      view.state.tr
        .replace(start, endBefore, doc.slice(start, endAfter))
        .setMeta('addToHistory', addToHistory),
    );
  });
  editorMarkdown = value;
  void nextTick(() => {
    if (container.value) container.value.scrollTop = scrollTop;
  });
  applyingExternalChange = false;
}
watch(
  () => props.modelValue,
  (value) => applyMarkdown(value),
);
watch(
  () => [props.searchMatches, props.activeSearchOffset],
  () => {
    crepe?.editor.action((context) => {
      const view = context.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(markRefreshKey, true));
    });
  },
);

watch(
  () => props.readonly,
  (value) => crepe?.setReadonly(Boolean(value)),
);

watch(
  () => props.annotations,
  () => {
    if (!crepe) return;
    crepe.editor.action((context) => {
      const view = context.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(markRefreshKey, true));
    });
  },
);

watch(
  () => props.terms,
  () => {
    if (!crepe) return;
    crepe.editor.action((context) => {
      const view = context.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(markRefreshKey, true));
    });
  },
);

onBeforeUnmount(() => {
  if (changeTimer) clearTimeout(changeTimer);
  disposed = true;
  mermaidRequests.clear();
  activeMermaidPreviews.clear();
  resolveReady();
  void crepe?.destroy();
});
</script>

<template>
  <div class="relative min-w-0" :class="embedded ? '' : 'h-full'">
    <div
      ref="container"
      class="rendered-editor min-w-0 overflow-x-hidden transition-opacity duration-150"
      :class="[
        editorReady ? 'opacity-100' : 'opacity-0',
        embedded ? 'rendered-editor-embedded' : 'h-full overflow-y-auto',
        !embedded && modelValue.length >= 100_000 ? 'rendered-editor-large' : '',
      ]"
      @click.capture="handleRenderedClick"
      @focusout="flush"
      @scroll.passive="keepHorizontalPosition"
    />
    <LoadingState
      v-if="!editorReady && !editorFailed"
      class="absolute inset-0"
      :label="locale === 'en' ? 'Preparing document…' : '正在排版文档…'"
    />
    <DiagramViewer
      v-if="expandedDiagram"
      :svg="expandedDiagram"
      :locale="locale"
      @close="expandedDiagram = ''"
    />
  </div>
</template>

<style>
.rendered-editor .milkdown {
  min-height: 100%;
  min-width: 0;
}
.rendered-editor-large .milkdown .ProseMirror > * {
  content-visibility: auto;
  contain-intrinsic-size: auto 100px;
}
.rendered-editor .milkdown .milkdown-code-block .preview svg {
  max-width: 100%;
  height: auto;
  cursor: zoom-in;
}
.vivin-mermaid-load {
  display: block;
  padding: 16px;
  cursor: pointer;
}
.vivin-mermaid-error {
  padding: 12px;
  white-space: pre-wrap;
}
</style>
