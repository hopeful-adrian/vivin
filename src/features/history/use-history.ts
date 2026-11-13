import { ref, watch } from 'vue';
import { t } from '../../lib/i18n';
import {
  listDocumentHistory,
  readDocumentHistory,
  type HistoryEntry,
  type HistoryReason,
} from '../../lib/project-api';
import { documents } from '../documents/use-documents';
import { lockSource, onProjectReset } from '../project/use-project';
import { confirmAction } from '../ui/use-dialog';
import { notify, report } from '../ui/use-toast';
import { panel } from '../workspace/use-layout';
import { activePath } from '../workspace/use-panes';

export const historyPath = ref<string | null>(null);
export const historyEntries = ref<HistoryEntry[]>([]);
export const historyLoading = ref(false);
export const selectedVersion = ref<{ entry: HistoryEntry; content: string } | null>(null);
let request = 0;

export function reasonLabel(reason: HistoryReason): string {
  return {
    save: t('保存前', 'Before save'),
    format: t('格式化前', 'Before formatting'),
    restore: t('恢复前', 'Before restore'),
    ai: t('AI 修改前', 'Before AI edit'),
  }[reason];
}

onProjectReset(() => {
  request++;
  historyPath.value = null;
  historyEntries.value = [];
  selectedVersion.value = null;
});

export async function loadHistory(path = activePath.value) {
  const current = ++request;
  historyPath.value = path;
  selectedVersion.value = null;
  historyEntries.value = [];
  if (!path) return;
  historyLoading.value = true;
  try {
    const entries = await listDocumentHistory(path);
    if (current === request) historyEntries.value = entries;
  } catch (error) {
    if (current === request) report(error);
  } finally {
    if (current === request) historyLoading.value = false;
  }
}

watch([panel, activePath], ([value, path]) => {
  if (value === 'history' && path !== historyPath.value) void loadHistory(path);
});

export function openHistory() {
  panel.value = 'history';
  void loadHistory();
}

export async function previewVersion(entry: HistoryEntry) {
  const path = historyPath.value;
  if (!path) return;
  const current = request;
  try {
    const content = await readDocumentHistory(path, entry.id);
    if (current === request) selectedVersion.value = { entry, content };
  } catch (error) {
    report(error);
  }
}

export async function restoreSelectedVersion() {
  const path = historyPath.value;
  const version = selectedVersion.value;
  if (!path || !version) return;
  if (lockSource(path)) {
    notify(t('文档已锁定，不能恢复', 'The document is locked'), 'warning');
    return;
  }
  if (
    !(await confirmAction(t('恢复到这个版本？', 'Restore this version?'), {
      message: t(
        '当前内容会先保存到版本历史，之后仍可恢复回来。',
        'The current content is kept in version history first, so you can return to it.',
      ),
      confirmLabel: t('恢复', 'Restore'),
    }))
  )
    return;
  try {
    if (!documents.docs.value[path]) await documents.open(path);
    if (await documents.restoreVersion(path, version.content)) {
      notify(t('已恢复到所选版本', 'Version restored'), 'success');
      await loadHistory(path);
    }
  } catch (error) {
    report(error);
  }
}
