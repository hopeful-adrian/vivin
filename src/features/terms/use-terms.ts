import { computed, nextTick, ref } from 'vue';
import { t } from '../../lib/i18n';
import {
  deleteTerm,
  setTermException,
  upsertTerm,
  type Term,
  type TermException,
} from '../../lib/project-api';
import { documents } from '../documents/use-documents';
import { data, onProjectReset, refresh } from '../project/use-project';
import { confirmAction } from '../ui/use-dialog';
import { report } from '../ui/use-toast';
import { panel } from '../workspace/use-layout';
import { panes } from '../workspace/use-panes';
import { createTermMatcher, termMarks, type TermMark } from './term-marks';

export const hoveredTerm = ref<{
  term: Term;
  document: string;
  offset: number | null;
  x: number;
  y: number;
} | null>(null);
export const focusedTermId = ref<string | null>(null);
export const termDialog = ref<{ id: string | null; name: string; definition: string } | null>(null);
let hideTimer: ReturnType<typeof setTimeout> | undefined;

onProjectReset(() => {
  hoveredTerm.value = null;
  termDialog.value = null;
});

/** Imported terms may start with a `来源：resources/…` line that links to the original file. */
export const hoveredTermDetail = computed(() => {
  const definition = hoveredTerm.value?.term.definition ?? '';
  const source = definition.match(/^来源：(resources\/[^\r\n]+)$/m)?.[1] ?? null;
  return {
    source,
    body: source ? definition.replace(/^来源：resources\/[^\r\n]+\r?\n?/m, '').trim() : definition,
  };
});

const matcher = computed(() => createTermMatcher(data.value.terms));

export const termMarksByDocument = computed(() => {
  const marks: Record<string, TermMark[]> = {};
  const contents = documents.markContents.value;
  for (const pane of panes.value)
    if (pane.path && !marks[pane.path])
      marks[pane.path] = termMarks(
        contents[pane.path] ?? documents.docs.value[pane.path]?.content ?? '',
        pane.path,
        matcher.value,
        data.value.terms,
        data.value.termExceptions,
      );
  return marks;
});

export function showTermHover(event: MouseEvent, document: string | null) {
  const target = event.target;
  if (!(target instanceof Element) || !document) {
    scheduleHideTerm();
    return;
  }
  const mark = target.closest<HTMLElement>('[data-term-id][data-term-offset]');
  if (!mark || target.closest('[data-annotation-id]')) {
    scheduleHideTerm();
    return;
  }
  const term = data.value.terms.find((item) => item.id === mark.dataset.termId);
  const offset = Number(mark.dataset.termOffset);
  if (!term || !Number.isInteger(offset)) {
    scheduleHideTerm();
    return;
  }
  keepTerm();
  const hover = hoveredTerm.value;
  if (hover?.term.id === term.id && hover.document === document && hover.offset === offset) return;
  const rect = mark.getBoundingClientRect();
  hoveredTerm.value = { term, document, offset, x: rect.left, y: rect.bottom + 6 };
  void nextTick(() => {
    const current = hoveredTerm.value;
    if (current?.term.id !== term.id || current.offset !== offset) return;
    const card = window.document.getElementById('vivin-term-popover');
    if (!card) return;
    hoveredTerm.value = {
      ...current,
      x: Math.max(12, Math.min(rect.left, window.innerWidth - card.offsetWidth - 12)),
      y:
        rect.bottom + 6 + card.offsetHeight <= window.innerHeight - 12
          ? rect.bottom + 6
          : Math.max(12, rect.top - card.offsetHeight - 6),
    };
  });
}

export function hideTermNow() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = undefined;
  hoveredTerm.value = null;
}

export function scheduleHideTerm() {
  if (!hoveredTerm.value) return;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hoveredTerm.value = null;
    hideTimer = undefined;
  }, 220);
}

export function keepTerm() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = undefined;
}

export async function disableTermHere() {
  const hover = hoveredTerm.value;
  if (!hover || hover.offset === null) return;
  try {
    await setTermException(hover.document, hover.term.id, hover.offset, true);
    await refresh();
    hoveredTerm.value = null;
  } catch (error) {
    report(error);
  }
}

export async function restoreTermException(exception: TermException) {
  try {
    await setTermException(
      exception.document,
      exception.termId,
      exception.offset,
      false,
      exception.id,
    );
    await refresh();
  } catch (error) {
    report(error);
  }
}

export function viewTerm(term: Term) {
  focusedTermId.value = term.id;
  panel.value = 'terms';
  hoveredTerm.value = null;
  void nextTick(() =>
    window.document.getElementById(`term-${term.id}`)?.scrollIntoView({ block: 'center' }),
  );
}

export async function editTerm(term?: Term) {
  termDialog.value = {
    id: term?.id ?? null,
    name: term?.name ?? '',
    definition: term?.definition ?? '',
  };
  await nextTick();
  window.document.getElementById('vivin-term-name')?.focus();
}

export async function saveTermDialog() {
  const draft = termDialog.value;
  if (!draft || !draft.name.trim()) return;
  try {
    await upsertTerm(draft.id, draft.name, draft.definition);
    termDialog.value = null;
    await refresh();
  } catch (error) {
    report(error);
  }
}

export async function removeTerm(id: string) {
  if (
    !(await confirmAction(t('删除这个术语吗？', 'Delete this term?'), {
      confirmLabel: t('删除', 'Delete'),
      danger: true,
    }))
  )
    return;
  try {
    await deleteTerm(id);
    await refresh();
  } catch (error) {
    report(error);
  }
}
