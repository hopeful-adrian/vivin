import { parseAppError } from '../../lib/app-error';
import { t } from '../../lib/i18n';
import {
  chooseProject,
  createDirectory,
  createDocument,
  createProject,
  deleteEntry,
  moveEntry,
  nativeAvailable,
  openProject,
  revealProjectEntry,
  setLocked,
  setPinned,
  type TreeNode,
} from '../../lib/project-api';
import { documents } from '../documents/use-documents';
import { readLocalJson } from '../settings/use-preferences';
import { confirmAction, requestText } from '../ui/use-dialog';
import { closeMenus } from '../ui/use-menus';
import { notify, report } from '../ui/use-toast';
import { flushEditors } from '../workspace/editor-registry';
import { trashLabel } from '../workspace/use-layout';
import { clearPanes, openDoc, remapPanes } from '../workspace/use-panes';
import { activateProject, busy, expanded, lockSource, project, refresh } from './use-project';

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export async function switchProject(create: boolean, path?: string) {
  flushEditors();
  closeMenus();
  if (busy.value) return;
  if (path && path === project.value?.path) return;
  if (!nativeAvailable()) {
    notify(t('请在桌面窗口中使用项目功能', 'Use project features in the desktop app'));
    return;
  }
  if (documents.dirty.value) {
    await documents.saveAll();
    if (
      documents.dirty.value &&
      !(await confirmAction(
        t('部分内容未能保存，仍要切换项目吗？', 'Some changes could not be saved. Switch anyway?'),
        { confirmLabel: t('放弃并切换', 'Discard and switch'), danger: true },
      ))
    )
      return;
  }
  const name = create ? (await requestText(t('项目名称', 'Project name')))?.trim() : undefined;
  if (create && !name) return;
  busy.value = true;
  try {
    const next = create
      ? await createProject(name ?? '')
      : path
        ? await openProject(path)
        : await chooseProject();
    if (!next) return;
    activateProject(next);
    await refresh();
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}

export async function restoreLastProject() {
  const path = readLocalJson('vivin.last-project');
  if (typeof path !== 'string' || !path || project.value) return;
  busy.value = true;
  try {
    activateProject(await openProject(path));
    await refresh();
  } catch (error) {
    notify(
      t(
        `无法重新打开上次的项目：${path}。${parseAppError(error).message}`,
        `Could not reopen the last project: ${path}. ${parseAppError(error).message}`,
      ),
      'warning',
      { label: t('打开其他项目', 'Open another'), run: () => switchProject(false) },
    );
  } finally {
    busy.value = false;
  }
}

export async function addDoc(directory = '') {
  closeMenus();
  const name = await requestText(t('文档名称', 'Document name'), t('未命名.md', 'Untitled.md'));
  if (!name?.trim()) return;
  try {
    const trimmed = name.trim();
    const created = await createDocument(
      directory,
      trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`,
    );
    documents.remember(created);
    if (directory) expanded.value.add(directory);
    await refresh();
    await openDoc(created.path);
  } catch (error) {
    report(error);
  }
}

export async function addDir(directory = '') {
  closeMenus();
  const name = await requestText(t('文件夹名称', 'Folder name'));
  if (!name?.trim()) return;
  try {
    await createDirectory(directory, name.trim());
    if (directory) expanded.value.add(directory);
    await refresh();
  } catch (error) {
    report(error);
  }
}

export async function revealEntry(path?: string) {
  closeMenus();
  try {
    await revealProjectEntry(path ?? null);
  } catch (error) {
    report(error);
  }
}

async function move(path: string, destination: string, name: string) {
  const next = await moveEntry(path, destination, name);
  documents.remapPaths(path, next);
  remapPanes(path, next);
  if (expanded.value.has(path)) expanded.value.add(next);
  return next;
}

export async function renameEntry(node: TreeNode) {
  flushEditors();
  const name = (await requestText(t('新名称', 'New name'), node.name))?.trim();
  if (!name || name === node.name) return;
  try {
    await move(node.path, parentOf(node.path), name);
    await refresh();
  } catch (error) {
    report(error);
  }
}

export async function moveEntryTo(node: TreeNode, destination?: string) {
  flushEditors();
  const target =
    destination ??
    (await requestText(
      t('目标文件夹（留空表示项目根目录）', 'Destination folder (blank for project root)'),
      parentOf(node.path),
    ));
  if (target === null) return;
  const folder = target.trim().replace(/^\/+|\/+$/g, '');
  if (folder === parentOf(node.path)) return;
  if (folder === node.path || folder.startsWith(`${node.path}/`)) {
    notify(t('不能移动到自身内部', 'A folder cannot be moved into itself'), 'warning');
    return;
  }
  try {
    await move(node.path, folder, node.name);
    if (folder) expanded.value.add(folder);
    await refresh();
  } catch (error) {
    report(error);
  }
}

/** Drag-and-drop target check: locked items and moves into themselves are refused. */
export function canDropInto(source: string, destination: string): boolean {
  if (lockSource(source) || (destination && lockSource(destination))) return false;
  if (destination === parentOf(source)) return false;
  return destination !== source && !destination.startsWith(`${source}/`);
}

export async function dropEntry(source: string, destination: string) {
  if (!canDropInto(source, destination)) return;
  try {
    await move(source, destination, nameOf(source));
    if (destination) expanded.value.add(destination);
    await refresh();
  } catch (error) {
    report(error);
  }
}

export async function deleteEntryWithTrash(node: TreeNode) {
  flushEditors();
  const trash = trashLabel.value;
  if (
    !(await confirmAction(
      t(`将“${node.name}”移到${trash}？`, `Move “${node.name}” to the ${trash}?`),
      {
        message:
          node.kind === 'directory'
            ? t(
                `文件夹内的全部内容会一起移走，可以从${trash}恢复。`,
                `Everything inside the folder moves with it. You can restore it from the ${trash}.`,
              )
            : t(`可以从${trash}恢复。`, `You can restore it from the ${trash}.`),
        confirmLabel: t(`移到${trash}`, `Move to ${trash}`),
        danger: true,
      },
    ))
  )
    return;
  try {
    try {
      await deleteEntry(node.path);
    } catch (error) {
      if (parseAppError(error).code !== 'trash_unavailable') throw error;
      if (
        !(await confirmAction(t(`无法移到${trash}`, `Could not move to the ${trash}`), {
          message: t(
            `“${node.name}”将被永久删除，无法恢复。要继续吗？`,
            `“${node.name}” will be permanently deleted and cannot be restored. Continue?`,
          ),
          confirmLabel: t('永久删除', 'Delete permanently'),
          danger: true,
        }))
      )
        return;
      await deleteEntry(node.path, true);
    }
    documents.dropPaths(node.path);
    clearPanes(node.path);
    await refresh();
    notify(t(`已删除“${node.name}”`, `Deleted “${node.name}”`), 'success');
  } catch (error) {
    report(error);
  }
}

export async function togglePinned(node: TreeNode) {
  try {
    await setPinned(node.path, !node.pinned);
    await refresh();
  } catch (error) {
    report(error);
  }
}

export async function toggleLocked(node: TreeNode) {
  flushEditors();
  try {
    if (node.lockSource !== node.path) await documents.saveAll();
    await setLocked(node.path, node.lockSource !== node.path);
    await refresh();
  } catch (error) {
    report(error);
  }
}

/** Applies a move or delete reported by the native side (for example an AI tool call). */
export function applyEntryMoved(from: string, to: string) {
  documents.remapPaths(from, to);
  remapPanes(from, to);
}

export function applyEntryDeleted(path: string) {
  documents.dropPaths(path);
  clearPanes(path);
}
