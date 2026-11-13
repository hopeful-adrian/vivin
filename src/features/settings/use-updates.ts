import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { ref, shallowRef } from 'vue';
import { writeLog } from '../../lib/app-log';
import { t } from '../../lib/i18n';
import { nativeAvailable, openReleasePage } from '../../lib/project-api';
import { documents } from '../documents/use-documents';
import { confirmAction } from '../ui/use-dialog';
import { notify, report } from '../ui/use-toast';
import { flushEditors } from '../workspace/editor-registry';
import { readLocalJson, usePreferences, writeLocalJson } from './use-preferences';

const releasesPage = 'https://github.com/hopeful-adrian/vivin/releases';
const day = 24 * 60 * 60 * 1000;
const { preferences } = usePreferences();

export const appVersion = ref('');
export const checkingUpdates = ref(false);
export const availableUpdate = shallowRef<Update | null>(null);
/** Download progress from 0 to 1 while installing; `null` when idle, NaN when the size is unknown. */
export const updateProgress = ref<number | null>(null);

export async function loadAppVersion() {
  if (!nativeAvailable() || appVersion.value) return;
  try {
    appVersion.value = await getVersion();
  } catch {
    appVersion.value = '';
  }
}

export function openReleaseNotes(version?: string) {
  void openReleasePage(version ? `${releasesPage}/tag/v${version}` : releasesPage).catch(report);
}

/** Manual checks always report; automatic checks run at most once a day and stay quiet. */
export async function checkForUpdates(manual: boolean) {
  if (!nativeAvailable() || checkingUpdates.value || updateProgress.value !== null) return;
  if (!manual) {
    const last = readLocalJson('vivin.last-update-check');
    if (!preferences.checkUpdates || (typeof last === 'number' && Date.now() - last < day)) return;
  }
  checkingUpdates.value = true;
  try {
    await loadAppVersion();
    const update = await check({ timeout: 15_000 });
    writeLocalJson('vivin.last-update-check', Date.now());
    if (!update) {
      if (manual) notify(t('已是最新版本', 'vivin is up to date'), 'success');
      return;
    }
    void availableUpdate.value?.close();
    availableUpdate.value = update;
    notify(
      t(`vivin ${update.version} 可以更新了`, `vivin ${update.version} is available`),
      'info',
      { label: t('更新并重启', 'Update and restart'), run: installUpdate },
    );
  } catch (error) {
    writeLog('warn', `Update check failed: ${String(error)}`);
    if (manual)
      notify(
        t(
          '暂时无法获取更新信息，可能是网络问题或还没有发布新版本。',
          'Could not get update information. The network may be down, or no release is published yet.',
        ),
        'warning',
        { label: t('打开发布页', 'Open releases'), run: () => openReleaseNotes() },
      );
  } finally {
    checkingUpdates.value = false;
  }
}

/** Downloads first so writing can continue; saves every document before the app is replaced. */
export async function installUpdate() {
  const update = availableUpdate.value;
  if (!update || updateProgress.value !== null) return;
  let total = 0;
  let received = 0;
  updateProgress.value = 0;
  try {
    await update.download((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? 0;
      else if (event.event === 'Progress') {
        received += event.data.chunkLength;
        updateProgress.value = total ? Math.min(received / total, 1) : Number.NaN;
      } else updateProgress.value = 1;
    });
    flushEditors();
    await documents.saveAll();
    if (
      documents.dirty.value &&
      !(await confirmAction(t('部分内容未能保存', 'Some changes could not be saved'), {
        message: t(
          '更新会重启应用并丢弃这些修改。要继续吗？',
          'Updating restarts vivin and discards them. Continue?',
        ),
        confirmLabel: t('丢弃并更新', 'Discard and update'),
        danger: true,
      }))
    ) {
      updateProgress.value = null;
      return;
    }
    await update.install();
    await relaunch();
  } catch (error) {
    updateProgress.value = null;
    writeLog('error', `Update install failed: ${String(error)}`);
    notify(
      t(
        '更新失败，可以稍后重试或手动下载安装。',
        'The update failed. Try again later or install it manually.',
      ),
      'error',
      { label: t('打开发布页', 'Open releases'), run: () => openReleaseNotes(update.version) },
    );
  }
}
