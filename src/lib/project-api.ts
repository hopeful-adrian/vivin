import { invoke, isTauri, type InvokeArgs } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { parseAppError } from './app-error';
import { t } from './i18n';

export interface ProjectInfo {
  name: string;
  path: string;
}

export interface TreeNode {
  name: string;
  path: string;
  kind: 'directory' | 'document';
  children: TreeNode[];
  pinned: boolean;
  lockSource: string | null;
}

export interface ResourceNode {
  name: string;
  path: string;
  localPath: string;
  kind: 'directory' | 'file';
  fileType: string;
  children: ResourceNode[];
}

export interface SearchHit {
  path: string;
  offset: number;
  excerpt: string;
}

export interface Term {
  id: string;
  name: string;
  definition: string;
}

export interface TermException {
  id: string;
  document: string;
  termId: string;
  offset: number;
  contextBefore: string;
  contextAfter: string;
}

export type AnnotationKind = 'todo' | 'comment' | 'question' | 'error';

export interface Annotation {
  id: string;
  document: string;
  kind: AnnotationKind;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  offset: number;
  note: string;
}

export interface ProjectData {
  schemaVersion: number;
  pinned: string[];
  locked: string[];
  terms: Term[];
  termExceptions: TermException[];
  annotations: Annotation[];
}

export interface Document {
  path: string;
  content: string;
  revision: string;
}

export type HistoryReason = 'save' | 'format' | 'restore' | 'ai';

export interface HistoryEntry {
  id: string;
  createdAt: number;
  size: number;
  reason: HistoryReason;
  revision: string;
}

export interface BridgeInfo {
  url: string;
  configPath: string;
}

/** Calls a native command and rejects with an `AppError` carrying a stable code. */
async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw parseAppError(error);
  }
}

export function nativeAvailable(): boolean {
  return isTauri();
}

export async function chooseProject(): Promise<ProjectInfo | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: t('打开 vivin 项目', 'Open vivin project'),
  });
  if (!selected || typeof selected !== 'string') return null;
  return call<ProjectInfo>('open_project', { path: selected });
}

export function openProject(path: string): Promise<ProjectInfo> {
  return call<ProjectInfo>('open_project', { path });
}

export function revealProjectEntry(path: string | null): Promise<void> {
  return call<void>('reveal_project_entry', { path });
}

export async function createProject(name: string): Promise<ProjectInfo | null> {
  const parent = await open({
    directory: true,
    multiple: false,
    title: t('选择新项目的存放位置', 'Choose a location for the new project'),
  });
  if (!parent || typeof parent !== 'string') return null;
  return call<ProjectInfo>('create_project', { parent, name });
}

export function listProjectTree(): Promise<TreeNode[]> {
  return call<TreeNode[]>('list_project_tree');
}

export function readDocumentRevision(path: string): Promise<string> {
  return call<string>('read_document_revision', { path });
}

export function readDocumentRevisions(paths: string[]): Promise<Record<string, string | null>> {
  return call<Record<string, string | null>>('read_document_revisions', { paths });
}

export function readDocument(path: string): Promise<Document> {
  return call<Document>('read_document', { path });
}

export function saveDocument(
  document: Document,
  snapshot?: Exclude<HistoryReason, 'save'>,
): Promise<Document> {
  return call<Document>('save_document', {
    path: document.path,
    content: document.content,
    expectedRevision: document.revision,
    snapshot: snapshot ?? null,
  });
}

export function saveConflictCopy(path: string, content: string, label: string): Promise<Document> {
  return call<Document>('save_conflict_copy', { path, content, label });
}

export function createDocument(directory: string, name: string): Promise<Document> {
  return call<Document>('create_document', { directory, name });
}

export function createDirectory(directory: string, name: string): Promise<string> {
  return call<string>('create_directory', { directory, name });
}

export function moveEntry(
  path: string,
  destinationDirectory: string,
  name: string,
): Promise<string> {
  return call<string>('move_entry', { path, destinationDirectory, name });
}

export function deleteEntry(path: string, permanent = false): Promise<void> {
  return call<void>('delete_entry', { path, permanent });
}

export function setPinned(path: string, pinned: boolean): Promise<void> {
  return call<void>('set_pinned', { path, pinned });
}

export function setLocked(path: string, locked: boolean): Promise<void> {
  return call<void>('set_locked', { path, locked });
}

export function getProjectData(): Promise<ProjectData> {
  return call<ProjectData>('get_project_data');
}

export function upsertTerm(id: string | null, name: string, definition: string): Promise<Term> {
  return call<Term>('upsert_term', { id, name, definition });
}

export function deleteTerm(id: string): Promise<void> {
  return call<void>('delete_term', { id });
}

export function setTermException(
  document: string,
  termId: string,
  offset: number,
  disabled: boolean,
  exceptionId?: string,
): Promise<TermException | null> {
  return call<TermException | null>('set_term_exception', {
    document,
    termId,
    offset,
    disabled,
    exceptionId: exceptionId ?? null,
  });
}

export function upsertAnnotation(annotation: Annotation): Promise<Annotation> {
  return call<Annotation>('upsert_annotation', { annotation });
}

export function deleteAnnotation(id: string): Promise<void> {
  return call<void>('delete_annotation', { id });
}

export function searchDocuments(query: string): Promise<SearchHit[]> {
  return call<SearchHit[]>('search_documents', { query });
}

export function listResources(): Promise<ResourceNode[]> {
  return call<ResourceNode[]>('list_resources');
}

export function openProjectReference(
  sourceDocument: string,
  target: string,
): Promise<{ kind: 'document' | 'external'; path: string | null }> {
  return call('open_project_reference', { sourceDocument, target });
}

export function openProjectResource(path: string): Promise<void> {
  return call('open_project_resource', { path });
}

export async function importImage(document: string, file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 20_000_000)
    throw new Error(t('图片不能超过 20 MB', 'Images must be 20 MB or smaller'));
  let binary = '';
  for (let from = 0; from < bytes.length; from += 8192)
    binary += String.fromCharCode(...bytes.subarray(from, from + 8192));
  return call<string>('import_image', {
    document,
    name: file.name || 'image.png',
    bytesBase64: btoa(binary),
  });
}

export function readProjectImage(document: string, source: string): Promise<string> {
  return call<string>('read_project_image', { document, source });
}

export function setDirtyDraft(dirty: boolean): Promise<void> {
  return call<void>('set_dirty_draft', { dirty });
}

export function publishDraft(
  path: string,
  content: string,
  baseRevision: string,
  sequence: number,
): Promise<string> {
  return call<string>('publish_draft', { path, content, baseRevision, sequence });
}

export function getPlatform(): Promise<'macos' | 'windows' | 'linux'> {
  return call<unknown>('get_platform').then((value) => {
    if (value !== 'macos' && value !== 'windows' && value !== 'linux')
      throw new Error(t('无法识别当前操作系统', 'Unknown operating system'));
    return value;
  });
}

export function reloadDocument(path: string): Promise<Document> {
  return call<Document>('reload_document', { path });
}

export function listDocumentHistory(path: string): Promise<HistoryEntry[]> {
  return call<HistoryEntry[]>('list_document_history', { path });
}

export function readDocumentHistory(path: string, id: string): Promise<string> {
  return call<string>('read_document_history', { path, id });
}

export function exportHtml(suggestedName: string, html: string): Promise<string | null> {
  return call<string | null>('export_html', { suggestedName, html });
}

export function printDocument(): Promise<void> {
  return call<void>('print_document');
}

export function openLogDirectory(): Promise<void> {
  return call<void>('open_log_directory');
}

export function openReleasePage(url: string): Promise<void> {
  return call<void>('open_release_page', { url });
}

export function bridgeInfo(): Promise<BridgeInfo> {
  return call<BridgeInfo>('bridge_info');
}
