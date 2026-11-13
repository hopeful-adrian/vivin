import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { t } from '../../lib/i18n';
import {
  getPlatform,
  nativeAvailable,
  type Document,
  type ProjectInfo,
} from '../../lib/project-api';
import { documents } from '../documents/use-documents';
import { activateProject, closeProject, project, refresh } from '../project/use-project';
import {
  applyEntryDeleted,
  applyEntryMoved,
  restoreLastProject,
} from '../project/use-project-actions';
import { checkForUpdates } from '../settings/use-updates';
import { confirmAction } from '../ui/use-dialog';
import { report } from '../ui/use-toast';
import { flushEditors } from './editor-registry';
import { platform, windowExpanded } from './use-layout';

/** File watching covers normal disks; this slower check covers network and synced folders. */
const fallbackInterval = 15_000;

/** Wires native events, window lifecycle and disk checks; returns a cleanup function. */
export function installNativeEvents(): () => void {
  const stops: UnlistenFn[] = [];
  const keep = (promise: Promise<UnlistenFn>) =>
    void promise.then((stop) => stops.push(stop)).catch(report);
  const timer = setInterval(() => {
    if (project.value) void documents.checkRevisions();
  }, fallbackInterval);
  const onFocus = () => {
    if (project.value) void documents.checkRevisions();
  };
  window.addEventListener('focus', onFocus);

  if (nativeAvailable()) {
    void getPlatform()
      .then((value) => (platform.value = value))
      .catch(report);
    const currentWindow = getCurrentWindow();
    const syncWindowSize = async () => {
      windowExpanded.value =
        (await currentWindow.isFullscreen()) || (await currentWindow.isMaximized());
    };
    void syncWindowSize();
    keep(currentWindow.onResized(() => void syncWindowSize()));
    keep(currentWindow.onCloseRequested((event) => handleCloseRequest(event, currentWindow)));
    keep(
      listen<ProjectInfo>('vivin://project-opened', (event) => {
        activateProject(event.payload);
        void refresh().catch(report);
      }),
    );
    keep(listen('vivin://project-closed', () => closeProject()));
    keep(
      listen<{ document: Document }>('vivin://document-written', (event) => {
        void documents.reload(event.payload.document.path).catch(report);
      }),
    );
    keep(
      listen<{ paths: string[] }>('vivin://documents-changed', (event) => {
        void documents.checkRevisions(event.payload.paths);
      }),
    );
    keep(
      listen('vivin://project-changed', () => {
        if (project.value) void refresh().catch(report);
      }),
    );
    keep(
      listen<{ from: string; to: string }>('vivin://entry-moved', (event) =>
        applyEntryMoved(event.payload.from, event.payload.to),
      ),
    );
    keep(
      listen<{ path: string }>('vivin://entry-deleted', (event) =>
        applyEntryDeleted(event.payload.path),
      ),
    );
    void restoreLastProject();
    setTimeout(() => void checkForUpdates(false), 5000);
  }

  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', onFocus);
    for (const stop of stops) stop();
  };
}

let closing = false;
let closePromptActive = false;

async function handleCloseRequest(
  event: { preventDefault(): void },
  currentWindow: ReturnType<typeof getCurrentWindow>,
) {
  if (closing) return;
  flushEditors();
  if (!documents.dirty.value && !closePromptActive) return;
  event.preventDefault();
  if (closePromptActive) return;
  closePromptActive = true;
  try {
    await documents.saveAll();
    if (
      documents.dirty.value &&
      !(await confirmAction(t('部分内容未能保存', 'Some changes could not be saved'), {
        message: t(
          '关闭窗口会丢弃这些修改。要继续关闭吗？',
          'Closing the window discards them. Close anyway?',
        ),
        confirmLabel: t('丢弃并关闭', 'Discard and close'),
        danger: true,
      }))
    )
      return;
    closing = true;
    try {
      await currentWindow.close();
    } catch (error) {
      closing = false;
      report(error);
    }
  } finally {
    closePromptActive = false;
  }
}
