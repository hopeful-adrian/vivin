import { formatDocument } from '../../lib/format-document';
import { t } from '../../lib/i18n';
import {
  nativeAvailable,
  publishDraft,
  readDocument,
  readDocumentRevisions,
  reloadDocument,
  saveConflictCopy,
  saveDocument,
  setDirtyDraft,
  type Document,
} from '../../lib/project-api';
import { lockSource, onProjectReset } from '../project/use-project';
import { usePreferences } from '../settings/use-preferences';
import { notify, report } from '../ui/use-toast';
import { flushEditors } from '../workspace/editor-registry';
import { createDocumentStore } from './document-store';

const { preferences } = usePreferences();
const conflictHandlers: ((copy: Document, source: string) => void)[] = [];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function conflictLabel() {
  const now = new Date();
  return `${t('冲突副本', 'conflict copy')} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export const documents = createDocumentStore({
  api: {
    readDocument,
    reloadDocument,
    saveDocument,
    publishDraft,
    readDocumentRevisions,
    saveConflictCopy,
    setDirtyDraft,
  },
  publishDrafts: nativeAvailable(),
  isLocked: (path) => lockSource(path) !== null,
  autoFormat: () => preferences.autoFormat,
  format: formatDocument,
  flushEditors,
  conflictLabel,
  onConflictCopy(copy, source) {
    for (const handler of conflictHandlers) handler(copy, source);
  },
  onConflictCopyFailed(path, error) {
    report(error);
    notify(
      t(
        `“${path}”在外部被修改，但无法另存冲突副本。你的修改仍在编辑器中，保存后会覆盖外部修改（外部版本可在版本历史中找回）。`,
        `“${path}” changed elsewhere and no conflict copy could be saved. Your edits remain in the editor; saving will replace the external change (it stays in version history).`,
      ),
      'warning',
    );
  },
  onError: report,
});

/** Lets the workspace offer to open a freshly written conflict copy. */
export function onConflictCopy(handler: (copy: Document, source: string) => void) {
  conflictHandlers.push(handler);
}

onProjectReset(() => documents.reset());
