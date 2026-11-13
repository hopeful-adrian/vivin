import { computed, nextTick, ref, watch } from 'vue';
import { annotationMarks, resolveAnnotation } from '../../lib/annotation-anchor';
import { t } from '../../lib/i18n';
import {
  deleteAnnotation,
  upsertAnnotation,
  type Annotation,
  type AnnotationKind,
} from '../../lib/project-api';
import { documents } from '../documents/use-documents';
import { data, lockSource, onProjectReset, refresh } from '../project/use-project';
import { confirmAction, requestText } from '../ui/use-dialog';
import { notify, report } from '../ui/use-toast';
import { sourceEditors } from '../workspace/editor-registry';
import { activePane, activePath, currentDoc, panes } from '../workspace/use-panes';

export const annotationKinds: { value: AnnotationKind; zh: string; en: string; color: string }[] = [
  { value: 'todo', zh: '待办', en: 'Todo', color: '#d69e16' },
  { value: 'comment', zh: '批注', en: 'Comment', color: '#2f7bdd' },
  { value: 'question', zh: '疑问', en: 'Question', color: '#ea701b' },
  { value: 'error', zh: '错误', en: 'Error', color: '#e04c66' },
];

export function kindLabel(kind: AnnotationKind): string {
  const item = annotationKinds.find((entry) => entry.value === kind);
  return item ? t(item.zh, item.en) : kind;
}

export function kindColor(kind: AnnotationKind): string {
  return annotationKinds.find((entry) => entry.value === kind)?.color ?? '#94a3b8';
}

export const selectedAnnotation = ref<Annotation | null>(null);
export const annotationPopoverAt = ref({ x: 0, y: 0 });
export const annotationPopoverSize = ref({ width: 320, height: 240 });
export const annotationEditing = ref(false);
export const annotationEditSize = ref({ width: 420, height: 320 });
export const annotationDraft = ref('');
export const annotationSaving = ref(false);
export const annotationFilter = ref<AnnotationKind>('todo');

let annotationAnchor: Element | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let resizeObserver: ResizeObserver | undefined;

onProjectReset(() => {
  selectedAnnotation.value = null;
  annotationEditing.value = false;
});

export const annotationsById = computed(
  () => new Map(data.value.annotations.map((annotation) => [annotation.id, annotation])),
);

export const annotationMarksByDocument = computed(() => {
  const marks: Record<string, ReturnType<typeof annotationMarks>> = {};
  const contents = documents.markContents.value;
  for (const pane of panes.value) {
    if (!pane.path || marks[pane.path]) continue;
    marks[pane.path] = annotationMarks(
      contents[pane.path] ?? documents.docs.value[pane.path]?.content ?? '',
      data.value.annotations.filter((item) => item.document === pane.path),
    );
  }
  return marks;
});

export function needsRelocation(annotation: Annotation): boolean {
  const doc = documents.docs.value[annotation.document];
  return !!doc && resolveAnnotation(doc.content, annotation) === null;
}

export function positionAnnotationPopover() {
  if (!annotationAnchor?.isConnected || !selectedAnnotation.value) return;
  const rect = annotationAnchor.getBoundingClientRect();
  const canvas = annotationAnchor
    .closest('section[data-pane-index]')
    ?.querySelector('.markdown-canvas');
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  annotationPopoverSize.value = {
    width: Math.floor((bounds.width * 2) / 3),
    height: Math.floor((bounds.height * 2) / 3),
  };
  const card = document.getElementById('vivin-annotation-popover');
  const width = Math.min(card?.offsetWidth ?? 200, annotationPopoverSize.value.width);
  const height = Math.min(card?.offsetHeight ?? 120, annotationPopoverSize.value.height);
  annotationPopoverAt.value = {
    x: Math.max(bounds.left, Math.min(rect.left, bounds.right - width)),
    y: Math.max(
      bounds.top,
      Math.min(
        rect.bottom + 8 + height <= bounds.bottom ? rect.bottom + 8 : rect.top - height - 8,
        bounds.bottom - height,
      ),
    ),
  };
}

watch(selectedAnnotation, async (annotation) => {
  resizeObserver?.disconnect();
  if (!annotation) return;
  await nextTick();
  positionAnnotationPopover();
  const card = document.getElementById('vivin-annotation-popover');
  const canvas = annotationAnchor
    ?.closest('section[data-pane-index]')
    ?.querySelector('.markdown-canvas');
  resizeObserver = new ResizeObserver(positionAnnotationPopover);
  if (card) resizeObserver.observe(card);
  if (canvas) resizeObserver.observe(canvas);
});
watch(annotationEditing, () => void nextTick(positionAnnotationPopover));

export function disposeAnnotationPopover() {
  resizeObserver?.disconnect();
  if (hideTimer) clearTimeout(hideTimer);
}

function showAnnotationPopover(annotation: Annotation, element: Element) {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = undefined;
  if (annotationEditing.value || selectedAnnotation.value?.id === annotation.id) return;
  annotationAnchor = element;
  const rect = element.getBoundingClientRect();
  annotationPopoverAt.value = {
    x: Math.max(12, Math.min(rect.left, window.innerWidth - 332)),
    y: rect.bottom + 8,
  };
  selectedAnnotation.value = annotation;
  annotationDraft.value = annotation.note;
  void nextTick(positionAnnotationPopover);
}

export function keepAnnotationPopover() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = undefined;
}

export function scheduleHideAnnotationPopover() {
  if (annotationEditing.value) return;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    selectedAnnotation.value = null;
    hideTimer = undefined;
  }, 180);
}

function annotationAt(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const mark = target.closest('[data-annotation-id]');
  const annotation = annotationsById.value.get(mark?.getAttribute('data-annotation-id') ?? '');
  return annotation && mark ? { annotation, mark } : null;
}

/** Returns whether the pointer is over an annotation. */
export function handleAnnotationHover(event: MouseEvent): boolean {
  const found = annotationAt(event);
  if (found) showAnnotationPopover(found.annotation, found.mark);
  else if (selectedAnnotation.value && !hideTimer) scheduleHideAnnotationPopover();
  return !!found;
}

export function handleAnnotationClick(event: MouseEvent) {
  const found = annotationAt(event);
  if (found) showAnnotationPopover(found.annotation, found.mark);
}

function textOffsets(content: string, text: string): number[] {
  if (!text) return [];
  const offsets: number[] = [];
  let from = 0;
  while (from < content.length) {
    const found = content.indexOf(text, from);
    if (found < 0) break;
    offsets.push(found);
    from = found + text.length;
  }
  return offsets;
}

/** Maps a selection in the rendered editor back to the Markdown source. */
function renderedSelection(content: string): { quote: string; offset: number } | null {
  const selection = window.getSelection();
  const range = selection && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  const rendered = Array.from(
    document.querySelectorAll(`[data-pane-index="${activePane.value}"] .rendered-editor`),
  ).find((element) => range && element.contains(range.commonAncestorContainer));
  if (!range || !rendered) return null;
  const quote = selection?.toString() ?? '';
  const walker = document.createTreeWalker(rendered, NodeFilter.SHOW_TEXT);
  let allText = '';
  let startAt = -1;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node === range.startContainer) startAt = allText.length + range.startOffset;
    allText += node.textContent ?? '';
  }
  const segment = rendered.closest<HTMLElement>('[data-segment-start]');
  const segmentStart = Number(segment?.dataset.segmentStart ?? 0);
  const segmentEnd = Number(segment?.dataset.segmentEnd ?? content.length);
  const raw = textOffsets(content.slice(segmentStart, segmentEnd), quote);
  const visible = textOffsets(allText, quote);
  const rank = visible.indexOf(startAt);
  const rawAtRank = raw[rank];
  if (quote && rank >= 0 && raw.length === visible.length && rawAtRank !== undefined)
    return { quote, offset: segmentStart + rawAtRank };
  const only = raw[0];
  if (quote && raw.length === 1 && only !== undefined)
    return { quote, offset: segmentStart + only };
  return null;
}

export async function addAnnotation(
  kind: AnnotationKind,
  selectedOverride?: { quote: string; offset: number },
) {
  const path = activePath.value;
  const doc = currentDoc.value;
  if (!path || !doc || lockSource(path)) return;
  const pane = panes.value[activePane.value];
  const selected =
    selectedOverride ??
    (pane?.mode === 'source'
      ? sourceEditors.get(pane.id)?.selectedText()
      : renderedSelection(doc.content)) ??
    null;
  if (!selected?.quote) {
    notify(t('请先在文档中选择要标注的文字', 'Select text in the document first'));
    return;
  }
  const { quote, offset } = selected;
  if (doc.content.slice(offset, offset + quote.length) !== quote) {
    notify(
      t(
        '无法准确定位选中文字，请切换原文模式重试',
        'Cannot locate the selection. Try source mode.',
      ),
      'warning',
    );
    return;
  }
  const note = await requestText(t('标注说明（可留空）', 'Annotation note (optional)'), '');
  if (note === null) return;
  try {
    await upsertAnnotation({
      id: '',
      document: path,
      kind,
      quote,
      offset,
      note,
      contextBefore: '',
      contextAfter: '',
    });
    await refresh();
  } catch (error) {
    report(error);
  }
}

export function requestEditorAnnotation(
  paneIndex: number,
  kind: AnnotationKind,
  selected: { quote: string; offset: number },
) {
  activePane.value = paneIndex;
  void addAnnotation(kind, selected);
}

export function startAnnotationEdit() {
  const annotation = selectedAnnotation.value;
  if (!annotation) return;
  keepAnnotationPopover();
  annotationDraft.value = annotation.note;
  const card = document.getElementById('vivin-annotation-popover');
  annotationEditSize.value = {
    width: Math.max(420, card?.offsetWidth ?? 0),
    height: Math.max(320, card?.offsetHeight ?? 0),
  };
  annotationEditing.value = true;
  void nextTick(() => document.getElementById('vivin-annotation-note')?.focus());
}

export async function updateAnnotation(annotation: Annotation) {
  if (annotationSaving.value) return;
  annotationSaving.value = true;
  try {
    const updated = await upsertAnnotation({ ...annotation, note: annotationDraft.value });
    if (selectedAnnotation.value?.id === annotation.id) selectedAnnotation.value = updated;
    annotationEditing.value = false;
    await refresh();
  } catch (error) {
    report(error);
  } finally {
    annotationSaving.value = false;
  }
}

export async function removeAnnotation(annotation: Annotation) {
  if (
    !(await confirmAction(t('删除这个标注吗？', 'Delete this annotation?'), {
      confirmLabel: t('删除', 'Delete'),
      danger: true,
    }))
  )
    return;
  try {
    await deleteAnnotation(annotation.id);
    selectedAnnotation.value = null;
    annotationEditing.value = false;
    await refresh();
  } catch (error) {
    report(error);
  }
}
