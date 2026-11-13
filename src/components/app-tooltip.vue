<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{ locale: 'zh' | 'en' }>();
// Crepe also exposes icon actions as divs. Keep their names here rather than
// observing or rewriting the editor DOM on every document transaction.
const editorActions = [
  ['.milkdown-block-handle .operation-item:first-child', '插入内容块', 'Insert block'],
  ['.milkdown-block-handle .operation-item:last-child', '拖动内容块', 'Drag block'],
  ['.link-preview .link-icon', '打开链接', 'Open link'],
  ['.link-preview .link-edit-button', '编辑链接', 'Edit link'],
  ['.link-preview .link-remove-button', '移除链接', 'Remove link'],
  ['.link-edit .confirm', '确认链接', 'Confirm link'],
  ['.milkdown-code-block .copy-button', '复制代码', 'Copy code'],
  ['.milkdown-code-block .language-button', '选择代码语言', 'Choose code language'],
  ['.milkdown-latex-inline-edit button', '确认公式', 'Confirm formula'],
  ['[data-role="col-drag-handle"] button:nth-child(1)', '列左对齐', 'Align column left'],
  ['[data-role="col-drag-handle"] button:nth-child(2)', '列居中对齐', 'Align column center'],
  ['[data-role="col-drag-handle"] button:nth-child(3)', '列右对齐', 'Align column right'],
  ['[data-role="col-drag-handle"] button:nth-child(4)', '删除列', 'Delete column'],
  ['[data-role="row-drag-handle"] button', '删除行', 'Delete row'],
  ['[data-role="x-line-drag-handle"] button', '添加行', 'Add row'],
  ['[data-role="y-line-drag-handle"] button', '添加列', 'Add column'],
  ['[data-role="col-drag-handle"]', '选择或拖动列', 'Select or drag column'],
  ['[data-role="row-drag-handle"]', '选择或拖动行', 'Select or drag row'],
] as const;
const selector = [
  'button',
  '[role="button"]',
  'select',
  'label[title]',
  ...editorActions.map(([actionSelector]) => actionSelector),
].join(',');
const tooltip = ref<HTMLDivElement>();
const host = ref<Element>(document.body);
const label = ref('');
const position = ref({ left: '0px', top: '0px', visibility: 'hidden' as 'hidden' | 'visible' });
let active: HTMLElement | null = null;
let originalTitle: string | null = null;
let addedLabel = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function hide() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (active) {
    if (originalTitle !== null && !active.hasAttribute('title'))
      active.setAttribute('title', originalTitle);
    if (addedLabel) active.removeAttribute('aria-label');
    const description = active
      .getAttribute('aria-describedby')
      ?.split(/\s+/)
      .filter((id) => id !== 'vivin-icon-tooltip')
      .join(' ');
    if (description) active.setAttribute('aria-describedby', description);
    else active.removeAttribute('aria-describedby');
  }
  active = null;
  originalTitle = null;
  addedLabel = false;
  label.value = '';
}

function show(event: Event) {
  if (event instanceof PointerEvent && event.pointerType === 'touch') return;
  const target =
    event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
  if (target === active) return;
  hide();
  if (
    !target ||
    target.matches(
      ':disabled, [aria-disabled="true"], [aria-haspopup="menu"][aria-expanded="true"]',
    )
  )
    return;
  const fallback = editorActions.find(([actionSelector]) => target.matches(actionSelector));
  const text =
    target.getAttribute('title') ||
    target.getAttribute('aria-label') ||
    (fallback ? fallback[props.locale === 'zh' ? 1 : 2] : '') ||
    (target.querySelector('svg') ? target.textContent?.trim() : '');
  if (!text) return;
  active = target;
  originalTitle = target.getAttribute('title');
  if (!target.getAttribute('aria-label') && !target.textContent?.trim()) {
    target.setAttribute('aria-label', text);
    addedLabel = true;
  }
  target.removeAttribute('title');
  host.value = target.closest('dialog[open]') ?? document.body;
  timer = setTimeout(
    async () => {
      if (
        active !== target ||
        !target.isConnected ||
        target.matches('[aria-haspopup="menu"][aria-expanded="true"]')
      )
        return hide();
      position.value.visibility = 'hidden';
      label.value = text;
      await nextTick();
      if (active !== target || !tooltip.value) return;
      const anchor = target.getBoundingClientRect();
      const bounds = tooltip.value.getBoundingClientRect();
      position.value = {
        left: `${Math.max(8, Math.min(window.innerWidth - bounds.width - 8, anchor.left + (anchor.width - bounds.width) / 2))}px`,
        top: `${Math.max(8, anchor.bottom + bounds.height + 14 < window.innerHeight ? anchor.bottom + 6 : anchor.top - bounds.height - 6)}px`,
        visibility: 'visible',
      };
      target.setAttribute(
        'aria-describedby',
        [target.getAttribute('aria-describedby'), 'vivin-icon-tooltip'].filter(Boolean).join(' '),
      );
    },
    event.type === 'focusin' ? 0 : 350,
  );
}

function leave(event: Event) {
  const related =
    event instanceof MouseEvent || event instanceof FocusEvent ? event.relatedTarget : null;
  if (active && related instanceof Node && active.contains(related)) return;
  hide();
}

onMounted(() => {
  document.addEventListener('pointerover', show, true);
  document.addEventListener('pointerout', leave, true);
  document.addEventListener('focusin', show, true);
  document.addEventListener('focusout', leave, true);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('click', hide, true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
});
onBeforeUnmount(() => {
  hide();
  document.removeEventListener('pointerover', show, true);
  document.removeEventListener('pointerout', leave, true);
  document.removeEventListener('focusin', show, true);
  document.removeEventListener('focusout', leave, true);
  document.removeEventListener('pointerdown', hide, true);
  document.removeEventListener('click', hide, true);
  document.removeEventListener('keydown', hide, true);
  document.removeEventListener('scroll', hide, true);
  window.removeEventListener('resize', hide);
  window.removeEventListener('blur', hide);
});
</script>

<template>
  <Teleport :to="host">
    <div
      v-if="label"
      id="vivin-icon-tooltip"
      ref="tooltip"
      role="tooltip"
      class="app-tooltip"
      :style="position"
    >
      {{ label }}
    </div>
  </Teleport>
</template>

<style>
.app-tooltip {
  position: fixed;
  z-index: 1000;
  max-width: min(320px, calc(100vw - 16px));
  padding: 6px 10px;
  border-radius: 6px;
  background: #172033;
  color: #fff;
  box-shadow: 0 4px 12px rgb(15 23 42 / 18%);
  font:
    12px / 1.5 -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  overflow-wrap: anywhere;
  pointer-events: none;
}
</style>
