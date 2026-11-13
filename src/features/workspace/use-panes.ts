import { computed, nextTick, ref, watch } from 'vue';
import type { SearchRange } from '../../lib/document-search';
import { t } from '../../lib/i18n';
import { openProjectReference, type AnnotationKind } from '../../lib/project-api';
import { textStats } from '../../lib/text-stats';
import { documents, onConflictCopy } from '../documents/use-documents';
import { lockSource, onProjectReset, project, refresh } from '../project/use-project';
import { readLocalJson, usePreferences, writeLocalJson } from '../settings/use-preferences';
import { notify, report } from '../ui/use-toast';
import {
  flushEditors,
  renderedEditors,
  sourceEditors,
  type RenderedEditorHandle,
  type SourceEditorHandle,
} from './editor-registry';
import { panel } from './use-layout';

export type Mode = 'source' | 'rendered';

export interface Pane {
  id: number;
  path: string | null;
  mode: Mode;
  outlineOpen: boolean;
  filters: AnnotationKind[];
  findOpen: boolean;
  searchMatches: SearchRange[];
  activeSearchOffset?: number;
}

interface PendingJump {
  path: string;
  paneIndex: number;
  offset: number;
  length: number;
  annotationId?: string;
}

export interface SourceRevealRequest {
  offset: number;
  length: number;
  token: number;
}

const allKinds: AnnotationKind[] = ['todo', 'comment', 'question', 'error'];
const recentLimit = 30;
const { preferences } = usePreferences();

let nextPaneId = 0;
function emptyPane(mode: Mode = 'rendered'): Pane {
  return {
    id: nextPaneId++,
    path: null,
    mode,
    findOpen: false,
    searchMatches: [],
    outlineOpen: false,
    filters: [...allKinds],
  };
}

export const panes = ref<Pane[]>([emptyPane()]);
export const activePane = ref(0);
export const split = ref(50);
export const loadingPanes = ref(new Set<number>());
export const sourceRevealRequests = ref<(SourceRevealRequest | null)[]>([]);
/** Selected word count per pane id, shown in the status bar. */
export const selectedWords = ref<Record<number, number>>({});
export const recentDocuments = ref<string[]>([]);
export const findPanels = new Map<number, { focus(selection?: string): void }>();

export const activePath = computed(() => panes.value[activePane.value]?.path ?? null);
export const currentDoc = computed(() =>
  activePath.value ? (documents.docs.value[activePath.value] ?? null) : null,
);

const paneRequestIds = new Map<number, number>();
const pendingHeadingJumps = new Map<number, { path: string; offset: number }>();
const headingJumpsInFlight = new Set<number>();
const sourceEditorRefs = new Map<number, (value: unknown) => void>();
const renderedEditorRefs = new Map<number, (value: unknown) => void>();
let revealToken = 0;
let pendingJump: PendingJump | null = null;

function recentStore(): Record<string, string[]> {
  const stored = readLocalJson('vivin.recent-documents');
  return stored && typeof stored === 'object' && !Array.isArray(stored)
    ? (stored as Record<string, string[]>)
    : {};
}

watch(project, (value) => {
  const stored = value ? recentStore()[value.path] : undefined;
  recentDocuments.value = Array.isArray(stored)
    ? stored.filter((item): item is string => typeof item === 'string').slice(0, recentLimit)
    : [];
});

function rememberDocument(path: string) {
  const current = project.value;
  if (!current) return;
  recentDocuments.value = [path, ...recentDocuments.value.filter((item) => item !== path)].slice(
    0,
    recentLimit,
  );
  writeLocalJson('vivin.recent-documents', {
    ...recentStore(),
    [current.path]: recentDocuments.value,
  });
}

export function remapRecentDocuments(from: string, to: string) {
  recentDocuments.value = recentDocuments.value.map((path) =>
    path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path,
  );
}

export function resetPanes() {
  pendingJump = null;
  pendingHeadingJumps.clear();
  paneRequestIds.clear();
  loadingPanes.value.clear();
  sourceRevealRequests.value = [];
  selectedWords.value = {};
  panes.value = [emptyPane()];
  activePane.value = 0;
  panel.value = 'none';
}
onProjectReset(resetPanes);

export function paneForPath(path: string): number {
  return panes.value.findIndex((pane) => pane.path === path);
}

export async function openDoc(path: string, paneIndex = activePane.value) {
  flushEditors();
  if (panel.value === 'terms') panel.value = 'none';
  if (
    panes.value[paneIndex]?.path === path &&
    documents.docs.value[path] &&
    !loadingPanes.value.has(paneIndex)
  ) {
    activePane.value = paneIndex;
    return;
  }
  const requestId = (paneRequestIds.get(paneIndex) ?? 0) + 1;
  paneRequestIds.set(paneIndex, requestId);
  pendingHeadingJumps.delete(paneIndex);
  loadingPanes.value.add(paneIndex);
  try {
    if (!(await documents.open(path))) return;
    await nextTick();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (paneRequestIds.get(paneIndex) !== requestId) return;
    const pane = panes.value[paneIndex];
    if (!pane) return;
    pane.path = path;
    pane.outlineOpen = false;
    pane.findOpen = false;
    pane.searchMatches = [];
    pane.activeSearchOffset = undefined;
    sourceRevealRequests.value[paneIndex] = null;
    activePane.value = paneIndex;
    rememberDocument(path);
  } catch (error) {
    report(error);
  } finally {
    if (paneRequestIds.get(paneIndex) === requestId) loadingPanes.value.delete(paneIndex);
  }
}

/** Opens a document beside the active one, creating the second pane when needed. */
export async function openBeside(path: string, mode?: Mode) {
  const createdSplit = panes.value.length === 1;
  if (createdSplit) toggleSplit();
  const target = activePane.value === 0 ? 1 : 0;
  await openDoc(path, target);
  const pane = panes.value[target];
  if (mode && pane?.path === path) pane.mode = mode;
}

export async function openReference(sourceDocument: string, href: string) {
  try {
    const result = await openProjectReference(sourceDocument, decodeURIComponent(href));
    if (result.kind !== 'document' || !result.path) return;
    await openBeside(result.path, 'rendered');
  } catch (error) {
    report(error);
  }
}

export async function jumpTo(path: string, offset: number, length = 0, annotationId?: string) {
  await openDoc(path);
  const paneIndex = activePane.value;
  const pane = panes.value[paneIndex];
  if (!pane || pane.path !== path) return;
  if (!annotationId) {
    pane.findOpen = false;
    pane.searchMatches = length ? [{ offset, length }] : [];
    pane.activeSearchOffset = offset;
  }
  if (pane.mode === 'source') {
    pendingJump = null;
    sourceRevealRequests.value[paneIndex] = { offset, length, token: ++revealToken };
    return;
  }
  pendingJump = { path, paneIndex, offset, length, annotationId };
  await nextTick();
  void revealPendingJump(paneIndex);
}

async function revealPendingJump(index: number) {
  const jump = pendingJump;
  if (!jump || jump.paneIndex !== index || panes.value[index]?.path !== jump.path) return;
  if (panes.value[index]?.mode !== 'rendered') return;
  const editor = renderedEditors.get(panes.value[index]?.id ?? -1);
  if (!editor) return;
  const found = jump.annotationId
    ? (await editor.revealAnnotation(jump.annotationId)) ||
      (await editor.reveal(jump.offset, jump.length))
    : await editor.reveal(jump.offset, jump.length);
  if (pendingJump !== jump) return;
  pendingJump = null;
  if (!found) notify(t('无法定位这个位置，请重试', 'Could not locate this position. Try again.'));
}

export function closeFind(index: number) {
  const pane = panes.value[index];
  if (!pane) return;
  pane.findOpen = false;
  pane.searchMatches = [];
  pane.activeSearchOffset = undefined;
  if (pane.mode === 'source') sourceEditors.get(pane.id)?.focus();
  else renderedEditors.get(pane.id)?.focus();
}

export async function openFind() {
  flushEditors();
  const pane = panes.value[activePane.value];
  if (!pane?.path) return;
  const selection =
    pane.mode === 'source'
      ? sourceEditors.get(pane.id)?.selectedText()?.quote
      : window.getSelection()?.toString() || undefined;
  pane.findOpen = true;
  await nextTick();
  findPanels.get(pane.id)?.focus(selection);
}

export function setSearchHighlights(index: number, matches: SearchRange[], active: number) {
  const pane = panes.value[index];
  if (!pane) return;
  pane.searchMatches = matches;
  pane.activeSearchOffset = matches[active]?.offset;
}

export function navigateFind(index: number, match: SearchRange) {
  const pane = panes.value[index];
  if (!pane) return;
  if (pane.mode === 'source')
    void sourceEditors.get(pane.id)?.reveal(match.offset, match.length, false);
  else void renderedEditors.get(pane.id)?.reveal(match.offset, match.length);
}

export function replaceFind(index: number, matches: SearchRange[], replacement: string) {
  const pane = panes.value[index];
  if (!pane?.path || lockSource(pane.path)) return;
  if (pane.mode === 'source') sourceEditors.get(pane.id)?.replaceMatches(matches, replacement);
  else renderedEditors.get(pane.id)?.replaceMatches(matches, replacement);
}

export function toggleOutline(index: number) {
  const pane = panes.value[index];
  if (!pane?.path || !documents.docs.value[pane.path]) return;
  activePane.value = index;
  pane.outlineOpen = !pane.outlineOpen;
}

export async function jumpToHeading(index: number, offset: number) {
  const pane = panes.value[index];
  if (!pane?.path) return;
  activePane.value = index;
  if (pane.mode === 'source') {
    sourceRevealRequests.value[index] = { offset, length: 0, token: ++revealToken };
    return;
  }
  pendingHeadingJumps.set(index, { path: pane.path, offset });
  await nextTick();
  void revealPendingHeading(index);
}

async function revealPendingHeading(index: number) {
  if (headingJumpsInFlight.has(index)) return;
  const jump = pendingHeadingJumps.get(index);
  if (!jump || panes.value[index]?.path !== jump.path) return;
  const editor = renderedEditors.get(panes.value[index]?.id ?? -1);
  if (!editor) return;
  headingJumpsInFlight.add(index);
  try {
    const found = await editor.revealHeading(jump.offset);
    if (pendingHeadingJumps.get(index) !== jump) return;
    pendingHeadingJumps.delete(index);
    if (!found) notify(t('无法定位这个标题，请重试', 'Could not locate this heading. Try again.'));
  } finally {
    headingJumpsInFlight.delete(index);
    if (pendingHeadingJumps.has(index)) void revealPendingHeading(index);
  }
}

export function sourceEditorRef(id: number) {
  let callback = sourceEditorRefs.get(id);
  if (!callback) {
    callback = (value) => {
      if (value) sourceEditors.set(id, value as SourceEditorHandle);
      else sourceEditors.delete(id);
    };
    sourceEditorRefs.set(id, callback);
  }
  return callback;
}

export function renderedEditorRef(id: number) {
  let callback = renderedEditorRefs.get(id);
  if (!callback) {
    callback = (value) => {
      if (!value) {
        renderedEditors.delete(id);
        return;
      }
      renderedEditors.set(id, value as RenderedEditorHandle);
      const index = panes.value.findIndex((pane) => pane.id === id);
      if (index >= 0) {
        void revealPendingJump(index);
        void revealPendingHeading(index);
      }
    };
    renderedEditorRefs.set(id, callback);
  }
  return callback;
}

export function setMode(index: number, mode: Mode) {
  const pane = panes.value[index];
  if (!pane || pane.mode === mode) return;
  renderedEditors.get(pane.id)?.flush();
  activePane.value = index;
  pane.mode = mode;
}

export function closePane(index: number) {
  flushEditors();
  if (panes.value.length <= 1) return;
  panes.value.splice(index, 1);
  sourceRevealRequests.value.splice(index, 1);
  pendingJump = null;
  pendingHeadingJumps.clear();
  paneRequestIds.clear();
  loadingPanes.value.clear();
  activePane.value = Math.max(0, activePane.value - (index <= activePane.value ? 1 : 0));
}

export function toggleSplit() {
  if (panes.value.length === 2) {
    closePane(activePane.value);
    return;
  }
  const currentMode = panes.value[activePane.value]?.mode ?? 'rendered';
  const mode = preferences.newPaneMode === 'same' ? currentMode : preferences.newPaneMode;
  panes.value.push({ ...emptyPane(mode), path: activePath.value });
}

export function remapPanes(from: string, to: string) {
  for (const pane of panes.value)
    if (pane.path === from || pane.path?.startsWith(`${from}/`))
      pane.path = to + pane.path.slice(from.length);
  remapRecentDocuments(from, to);
}

export function clearPanes(path: string) {
  for (const pane of panes.value)
    if (pane.path === path || pane.path?.startsWith(`${path}/`)) pane.path = null;
  recentDocuments.value = recentDocuments.value.filter(
    (item) => item !== path && !item.startsWith(`${path}/`),
  );
}

export function startSplitResize(event: PointerEvent) {
  const handle = event.currentTarget;
  if (!(handle instanceof HTMLElement)) return;
  const host = handle.parentElement;
  if (!host) return;
  trackPointer(handle, event, (next) => {
    const rect = host.getBoundingClientRect();
    split.value = Math.max(25, Math.min(75, (100 * (next.clientX - rect.left)) / rect.width));
  });
}

export function trackPointer(
  handle: HTMLElement,
  event: PointerEvent,
  move: (event: PointerEvent) => void,
) {
  handle.setPointerCapture(event.pointerId);
  const stop = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', stop);
    handle.removeEventListener('pointercancel', stop);
    handle.removeEventListener('lostpointercapture', stop);
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
}

/** Tracks the selected word count of whichever pane holds the selection. */
export function updateSelectionStats() {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  const element = anchor instanceof Element ? anchor : anchor?.parentElement;
  const section = element?.closest<HTMLElement>('section[data-pane-index]');
  const index = Number(section?.dataset.paneIndex ?? -1);
  const pane = panes.value[index];
  const next: Record<number, number> = {};
  if (pane && selection && !selection.isCollapsed)
    next[pane.id] = textStats(selection.toString()).words;
  const previous = selectedWords.value;
  if (JSON.stringify(previous) !== JSON.stringify(next)) selectedWords.value = next;
}

onConflictCopy((copy, source) => {
  void refresh().catch(report);
  notify(
    t(
      `“${source}”在外部被修改，已加载新版本。你未保存的内容已另存为“${copy.path}”。`,
      `“${source}” changed elsewhere and the new version was loaded. Your unsaved text was saved as “${copy.path}”.`,
    ),
    'warning',
    { label: t('打开副本', 'Open copy'), run: () => openBeside(copy.path) },
  );
});
