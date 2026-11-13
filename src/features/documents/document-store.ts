import { computed, ref, shallowRef, watch } from 'vue';
import { errorMessage, isRevisionConflict } from '../../lib/app-error.ts';
import type { Document, HistoryReason } from '../../lib/project-api';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed';
export type SnapshotReason = Exclude<HistoryReason, 'save'>;
export type FormatResult = 'formatted' | 'unchanged' | 'skipped' | { error: unknown };

export interface DocState extends Document {
  savedContent: string;
  /** A reload from disk is in progress; edits are not saved until it finishes. */
  conflict: boolean;
  saving: boolean;
  error: string | null;
}

export interface DocumentApi {
  readDocument(path: string): Promise<Document>;
  reloadDocument(path: string): Promise<Document>;
  saveDocument(document: Document, snapshot?: SnapshotReason): Promise<Document>;
  publishDraft(
    path: string,
    content: string,
    baseRevision: string,
    sequence: number,
  ): Promise<string>;
  readDocumentRevisions(paths: string[]): Promise<Record<string, string | null>>;
  saveConflictCopy(path: string, content: string, label: string): Promise<Document>;
  setDirtyDraft(dirty: boolean): Promise<void>;
}

export interface DocumentStoreOptions {
  api: DocumentApi;
  /** Shares unsaved text with the native side so AI reads see the editor state. */
  publishDrafts: boolean;
  isLocked(path: string): boolean;
  autoFormat(): boolean;
  format(content: string): Promise<string>;
  flushEditors?(): void;
  conflictLabel(): string;
  onConflictCopy(copy: Document, source: string): void;
  onConflictCopyFailed(path: string, error: unknown): void;
  onError(error: unknown): void;
  delays?: Partial<{ marks: number; draft: number; save: number }>;
}

export function within(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

const revisionBatch = 64;

export function createDocumentStore(options: DocumentStoreOptions) {
  const { api } = options;
  const delays = { marks: 250, draft: 750, save: 1400, ...options.delays };
  const docs = ref<Record<string, DocState>>({});
  /** Debounced copy of each document used for annotation and term marks. */
  const markContents = shallowRef<Record<string, string>>({});
  const formattingPaths = ref(new Set<string>());
  const formatSnapshots = shallowRef<
    Record<string, { doc: DocState; before: string; after: string }>
  >({});
  const preservedFormatting = new WeakMap<DocState, string>();
  const pendingSnapshots = new Map<string, SnapshotReason>();
  const draftSequences = new Map<string, number>();
  const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const markTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  const dirty = computed(() =>
    Object.values(docs.value).some((doc) => doc.content !== doc.savedContent),
  );
  const saving = computed(() => Object.values(docs.value).some((doc) => doc.saving));
  if (options.publishDrafts)
    watch(dirty, (value) => void api.setDirtyDraft(value).catch(options.onError));

  function saveState(path: string): SaveState {
    const doc = docs.value[path];
    if (!doc) return 'saved';
    if (doc.saving) return 'saving';
    if (doc.error) return 'failed';
    return doc.content === doc.savedContent ? 'saved' : 'unsaved';
  }

  function remember(document: Document): DocState {
    docs.value[document.path] = {
      ...document,
      savedContent: document.content,
      conflict: false,
      saving: false,
      error: null,
    };
    markContents.value = { ...markContents.value, [document.path]: document.content };
    return docs.value[document.path] as DocState;
  }

  async function open(path: string): Promise<DocState | null> {
    const existing = docs.value[path];
    if (existing) return existing;
    const current = generation;
    const loaded = await api.readDocument(path);
    if (current !== generation) return null;
    return docs.value[path] ?? remember(loaded);
  }

  function cancelDraft(path: string) {
    const timer = draftTimers.get(path);
    if (timer) clearTimeout(timer);
    draftTimers.delete(path);
    draftSequences.set(path, (draftSequences.get(path) ?? 0) + 1);
  }

  function publish(path: string, doc: DocState, content: string, revision: string) {
    if (!options.publishDrafts) return;
    const sequence = (draftSequences.get(path) ?? 0) + 1;
    draftSequences.set(path, sequence);
    void api.publishDraft(path, content, revision, sequence).catch((error) => {
      if (draftSequences.get(path) !== sequence || docs.value[path] !== doc) return;
      if (isRevisionConflict(error)) void reload(path, doc).catch(options.onError);
      else options.onError(error);
    });
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveAll(), delays.save);
  }

  function setContent(path: string, content: string) {
    const doc = docs.value[path];
    if (!doc || options.isLocked(path) || doc.content === content) return;
    doc.content = content;
    doc.error = null;
    const previousMarkTimer = markTimers.get(path);
    if (previousMarkTimer) clearTimeout(previousMarkTimer);
    markTimers.set(
      path,
      setTimeout(() => {
        markTimers.delete(path);
        if (docs.value[path] !== doc) return;
        markContents.value = { ...markContents.value, [path]: doc.content };
      }, delays.marks),
    );
    if (options.publishDrafts) {
      const previousTimer = draftTimers.get(path);
      if (previousTimer) clearTimeout(previousTimer);
      draftTimers.set(
        path,
        setTimeout(() => {
          draftTimers.delete(path);
          if (docs.value[path] !== doc || doc.content !== content) return;
          publish(path, doc, content, doc.revision);
        }, delays.draft),
      );
    }
    scheduleSave();
  }

  async function saveOne(path: string) {
    const doc = docs.value[path];
    if (
      !doc ||
      doc.saving ||
      doc.conflict ||
      doc.content === doc.savedContent ||
      options.isLocked(path) ||
      formattingPaths.value.has(path)
    )
      return;
    doc.saving = true;
    try {
      if (options.autoFormat() && preservedFormatting.get(doc) !== doc.content)
        await formatOne(path);
      if (docs.value[path] !== doc || doc.conflict || options.isLocked(path)) return;
      cancelDraft(path);
      const submitted = doc.content;
      const snapshot = pendingSnapshots.get(path);
      try {
        const saved = await api.saveDocument(
          { path, content: submitted, revision: doc.revision },
          snapshot,
        );
        doc.revision = saved.revision;
        doc.savedContent = submitted;
        doc.error = null;
        if (pendingSnapshots.get(path) === snapshot) pendingSnapshots.delete(path);
        if (doc.content !== submitted) publish(path, doc, doc.content, saved.revision);
      } catch (error) {
        if (isRevisionConflict(error)) {
          doc.saving = false;
          await reload(path, doc).catch(options.onError);
        } else {
          doc.error = errorMessage(error);
          options.onError(error);
        }
      }
    } finally {
      doc.saving = false;
    }
  }

  async function saveAll() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    options.flushEditors?.();
    await Promise.all(Object.keys(docs.value).map(saveOne));
  }

  /**
   * Loads the disk version. Unsaved local text that differs from it is first kept as a
   * conflict copy next to the document, so neither side is lost.
   */
  async function reload(path: string, expected = docs.value[path]) {
    if (!expected || docs.value[path] !== expected) return;
    const current = generation;
    expected.conflict = true;
    cancelDraft(path);
    let loaded: Document;
    try {
      loaded = await api.reloadDocument(path);
    } catch (error) {
      expected.conflict = false;
      throw error;
    }
    if (current !== generation || docs.value[path] !== expected) return;
    const local = expected.content;
    if (local !== expected.savedContent && local !== loaded.content) {
      try {
        const copy = await api.saveConflictCopy(path, local, options.conflictLabel());
        if (current !== generation) return;
        options.onConflictCopy(copy, path);
      } catch (error) {
        if (current !== generation || docs.value[path] !== expected) return;
        // The edits stay in the editor on top of the new disk version.
        expected.revision = loaded.revision;
        expected.savedContent = loaded.content;
        expected.conflict = false;
        options.onConflictCopyFailed(path, error);
        return;
      }
      if (docs.value[path] !== expected) return;
    }
    dropFormatSnapshot(path);
    remember(loaded);
  }

  /** Reloads documents whose disk revision differs from the one being edited. */
  async function checkRevisions(paths?: string[]) {
    const targets = (paths ?? Object.keys(docs.value)).filter((path) => docs.value[path]);
    const current = generation;
    for (let from = 0; from < targets.length; from += revisionBatch) {
      const batch = targets.slice(from, from + revisionBatch);
      const expected = new Map(
        batch.map((path) => {
          const doc = docs.value[path] as DocState;
          return [path, { doc, revision: doc.revision }];
        }),
      );
      let revisions: Record<string, string | null>;
      try {
        revisions = await api.readDocumentRevisions(batch);
      } catch {
        // A temporary failure during an external atomic save is retried by the next check.
        continue;
      }
      if (current !== generation) return;
      for (const [path, { doc, revision }] of expected) {
        const disk = revisions[path];
        if (!disk || disk === revision) continue;
        if (docs.value[path] !== doc || doc.saving || doc.conflict || doc.revision !== revision)
          continue;
        await reload(path, doc).catch(options.onError);
      }
    }
  }

  function dropFormatSnapshot(path: string) {
    if (!formatSnapshots.value[path]) return;
    const next = { ...formatSnapshots.value };
    delete next[path];
    formatSnapshots.value = next;
  }

  async function formatOne(path: string, manual = false): Promise<FormatResult> {
    if (manual) options.flushEditors?.();
    const doc = docs.value[path];
    if (!doc || doc.conflict || options.isLocked(path) || formattingPaths.value.has(path))
      return 'skipped';
    const original = doc.content;
    const revision = doc.revision;
    formattingPaths.value.add(path);
    try {
      const formatted = await options.format(original);
      if (
        docs.value[path] !== doc ||
        doc.content !== original ||
        doc.revision !== revision ||
        doc.conflict ||
        options.isLocked(path)
      )
        return 'skipped';
      if (formatted === original) return 'unchanged';
      if (manual && original === doc.savedContent) pendingSnapshots.set(path, 'format');
      setContent(path, formatted);
      formatSnapshots.value = {
        ...formatSnapshots.value,
        [path]: { doc, before: original, after: formatted },
      };
      return 'formatted';
    } catch (error) {
      return { error };
    } finally {
      formattingPaths.value.delete(path);
    }
  }

  function canUndoFormat(path: string): boolean {
    const snapshot = formatSnapshots.value[path];
    const doc = docs.value[path];
    return (
      !!snapshot &&
      snapshot.doc === doc &&
      snapshot.after === doc.content &&
      !doc.conflict &&
      !options.isLocked(path)
    );
  }

  function undoFormat(path: string): boolean {
    const snapshot = formatSnapshots.value[path];
    if (!snapshot || !canUndoFormat(path)) return false;
    preservedFormatting.set(snapshot.doc, snapshot.before);
    setContent(path, snapshot.before);
    return true;
  }

  /** Writes an older version back as a normal edit, keeping the current one in history. */
  async function restoreVersion(path: string, content: string): Promise<boolean> {
    const doc = docs.value[path];
    if (!doc || options.isLocked(path) || doc.conflict) return false;
    if (doc.content === content) return true;
    preservedFormatting.set(doc, content);
    pendingSnapshots.set(path, 'restore');
    setContent(path, content);
    await saveOne(path);
    return docs.value[path]?.savedContent === content;
  }

  function remapPaths(from: string, to: string) {
    for (const [path, doc] of Object.entries(docs.value)) {
      if (!within(path, from)) continue;
      const next = to + path.slice(from.length);
      cancelDraft(path);
      delete docs.value[path];
      doc.path = next;
      docs.value[next] = doc;
      const marks = markContents.value[path];
      if (marks !== undefined) {
        const nextMarks = { ...markContents.value, [next]: marks };
        delete nextMarks[path];
        markContents.value = nextMarks;
      }
      dropFormatSnapshot(path);
      pendingSnapshots.delete(path);
    }
  }

  function dropPaths(prefix: string) {
    for (const path of Object.keys(docs.value))
      if (within(path, prefix)) {
        cancelDraft(path);
        dropFormatSnapshot(path);
        pendingSnapshots.delete(path);
        delete docs.value[path];
      }
  }

  function clearTimers() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    for (const timer of draftTimers.values()) clearTimeout(timer);
    for (const timer of markTimers.values()) clearTimeout(timer);
    draftTimers.clear();
    markTimers.clear();
  }

  function reset() {
    generation++;
    clearTimers();
    docs.value = {};
    markContents.value = {};
    formatSnapshots.value = {};
    formattingPaths.value.clear();
    pendingSnapshots.clear();
    draftSequences.clear();
  }

  return {
    docs,
    markContents,
    formattingPaths,
    dirty,
    saving,
    saveState,
    remember,
    open,
    setContent,
    saveOne,
    saveAll,
    reload,
    checkRevisions,
    formatOne,
    canUndoFormat,
    undoFormat,
    restoreVersion,
    remapPaths,
    dropPaths,
    reset,
    dispose: clearTimers,
  };
}

export type DocumentStore = ReturnType<typeof createDocumentStore>;
