<script lang="ts">
import type { PreviewSection } from '../lib/markdown-preview';

// Shared worker and bounded cache: notes are parsed only after a popover opens.
let worker: Worker | undefined;
let requestId = 0;
const cache = new Map<string, PreviewSection[]>();
const pending = new Map<
  number,
  { resolve: (sections: PreviewSection[]) => void; reject: (error: Error) => void }
>();
function parseNote(markdown: string): Promise<PreviewSection[]> {
  const cached = cache.get(markdown);
  if (cached) return Promise.resolve(cached);
  if (!worker) {
    worker = new Worker(new URL('../lib/markdown-preview.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (
      event: MessageEvent<{ id: number; sections?: PreviewSection[]; error?: string }>,
    ) => {
      const request = pending.get(event.data.id);
      pending.delete(event.data.id);
      if (event.data.error) request?.reject(new Error(event.data.error));
      else request?.resolve(event.data.sections ?? []);
    };
    worker.onerror = () => {
      for (const request of pending.values())
        request.reject(new Error('Markdown rendering failed'));
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  return new Promise<PreviewSection[]>((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    worker?.postMessage({ id, markdown });
  }).then((sections) => {
    cache.set(markdown, sections);
    if (cache.size > 24) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return sections;
  });
}
</script>

<script setup lang="ts">
import type { RootContent } from 'hast';
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type VNodeChild,
} from 'vue';
import { mermaidSource } from '../lib/mermaid-source';
import MermaidDiagram from './mermaid-diagram.vue';
import PreviewImage from './preview-image.vue';
import 'katex/dist/katex.min.css';

const props = defineProps<{
  markdown: string;
  documentPath: string;
  locale: 'zh' | 'en';
  theme: 'light' | 'dark';
}>();
const emit = defineEmits<{ ready: []; 'open-reference': [href: string] }>();
const sections = shallowRef<PreviewSection[]>([]);
const loading = ref(true);
const failed = ref(false);
let generation = 0;
watch(
  () => props.markdown,
  async (markdown) => {
    const current = ++generation;
    loading.value = true;
    failed.value = false;
    try {
      const result = await parseNote(markdown);
      if (current !== generation) return;
      sections.value = result;
    } catch {
      if (current === generation) failed.value = true;
    } finally {
      if (current === generation) {
        loading.value = false;
        emit('ready');
      }
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
});
const nodes = computed(() => sections.value.flatMap((section) => section.nodes));
const Content = defineComponent(() => () => nodes.value.map(renderNode));
function renderNode(node: RootContent): VNodeChild {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return null;
  const diagram = mermaidSource(node);
  if (diagram !== undefined)
    return h(MermaidDiagram, { content: diagram, theme: props.theme, locale: props.locale });
  if (node.tagName === 'img')
    return h(PreviewImage, {
      src: String(node.properties.src ?? ''),
      alt: String(node.properties.alt ?? ''),
      documentPath: props.documentPath,
    });
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.properties)) {
    attributes[key === 'className' ? 'class' : key === 'htmlFor' ? 'for' : key] = Array.isArray(
      value,
    )
      ? value.join(' ')
      : value;
  }
  if (node.tagName === 'a')
    attributes.onClick = (event: MouseEvent) => {
      event.preventDefault();
      emit('open-reference', String(node.properties.href ?? ''));
    };
  if (node.tagName === 'ul' || node.tagName === 'ol') {
    const start = typeof node.properties.start === 'number' ? node.properties.start : 1;
    const items = node.children.filter(
      (child) => child.type === 'element' && child.tagName === 'li',
    );
    return h(
      node.tagName,
      attributes,
      items.map((item, index) => {
        if (item.type !== 'element') return null;
        const task =
          Array.isArray(item.properties.className) &&
          item.properties.className.includes('task-list-item');
        return h('div', { class: 'milkdown-list-item-block' }, [
          h('li', { class: 'list-item' }, [
            h('div', { class: 'label-wrapper', 'aria-hidden': true }, [
              h(
                'span',
                { class: 'label' },
                task ? '' : node.tagName === 'ol' ? `${start + index}.` : '•',
              ),
            ]),
            h(
              'div',
              { class: 'children' },
              item.children.map((child) => renderNode(child)),
            ),
          ]),
        ]);
      }),
    );
  }
  const rendered = h(node.tagName, attributes, node.children.map(renderNode));
  return node.tagName === 'table'
    ? h('div', { class: 'milkdown-table-block' }, [rendered])
    : rendered;
}
</script>

<template>
  <p v-if="loading" class="p-3 text-xs text-slate-400" role="status">
    {{ locale === 'en' ? 'Loading…' : '正在加载…' }}
  </p>
  <p v-else-if="failed" class="annotation-markdown-content whitespace-pre-wrap p-3">
    {{ markdown }}
  </p>
  <div v-else class="milkdown">
    <div class="ProseMirror annotation-markdown-content"><Content /></div>
  </div>
</template>

<style>
/* Only the note viewport changes; typography comes from the official theme. */
.annotation-markdown-content {
  padding: 12px !important;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
