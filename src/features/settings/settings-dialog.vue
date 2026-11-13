<script setup lang="ts">
import { Copy, X } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { documentThemes } from '../../lib/editor-theme';
import { t } from '../../lib/i18n';
import {
  bridgeInfo,
  nativeAvailable,
  openLogDirectory,
  type BridgeInfo,
} from '../../lib/project-api';
import { commands, settingsTab } from '../commands/use-commands';
import { notify, report } from '../ui/use-toast';
import { settingsOpen, shortcutLabel } from '../workspace/use-layout';
import { editorScales } from './preferences';
import { usePreferences } from './use-preferences';
import {
  appVersion,
  availableUpdate,
  checkForUpdates,
  checkingUpdates,
  installUpdate,
  loadAppVersion,
  openReleaseNotes,
  updateProgress,
} from './use-updates';

const { preferences } = usePreferences();
const bridge = ref<BridgeInfo | null>(null);

const progressLabel = computed(() => {
  const progress = updateProgress.value ?? 0;
  if (progress >= 1) return t('下载完成，正在安装…', 'Downloaded. Installing…');
  return Number.isNaN(progress)
    ? t('正在下载更新…', 'Downloading the update…')
    : t(
        `正在下载更新 ${Math.round(progress * 100)}%`,
        `Downloading the update ${Math.round(progress * 100)}%`,
      );
});

const tabs = computed(() => [
  { id: 'general' as const, label: t('通用', 'General') },
  { id: 'editor' as const, label: t('编辑', 'Editing') },
  { id: 'shortcuts' as const, label: t('快捷键', 'Shortcuts') },
  { id: 'about' as const, label: t('关于', 'About') },
]);

const shortcutGroups = computed(() => {
  const groups = new Map<string, { title: string; shortcut: string }[]>();
  for (const command of commands.value) {
    if (!command.shortcut) continue;
    const list = groups.get(command.group) ?? [];
    list.push({ title: command.title, shortcut: shortcutLabel(command.shortcut) });
    groups.set(command.group, list);
  }
  return [...groups.entries()];
});

watch(
  () => settingsOpen.value && settingsTab.value === 'about',
  async (about) => {
    if (!about || !nativeAvailable()) return;
    void loadAppVersion();
    if (!bridge.value) bridge.value = await bridgeInfo().catch(() => null);
  },
  { immediate: true },
);

function copy(text: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => notify(t('已复制', 'Copied'), 'success'))
    .catch(report);
}

function openLogs() {
  void openLogDirectory().catch(report);
}

function scaleLabel(scale: number) {
  return `${Math.round(scale * 100)}%`;
}
</script>

<template>
  <div
    v-if="settingsOpen"
    class="fixed inset-0 z-[105] flex items-center justify-center bg-slate-950/30"
    @click.self="settingsOpen = false"
  >
    <div
      class="settings-dialog flex h-[min(560px,calc(100vh-48px))] w-[min(720px,calc(100vw-32px))] overflow-hidden rounded-2xl bg-white shadow-2xl"
      role="dialog"
      aria-modal="true"
      :aria-label="t('设置', 'Settings')"
      @click.stop
    >
      <nav class="settings-nav flex w-40 shrink-0 flex-col gap-0.5 p-3">
        <h2 class="px-2 pt-1 pb-3 text-sm font-semibold">{{ t('设置', 'Settings') }}</h2>
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="rounded-lg px-3 py-1.5 text-left text-sm"
          :class="settingsTab === tab.id ? 'bg-blue-600 text-white' : 'hover:bg-slate-200/70'"
          :aria-current="settingsTab === tab.id ? 'page' : undefined"
          @click="settingsTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex shrink-0 items-center justify-between px-6 pt-4">
          <h3 class="text-base font-semibold">
            {{ tabs.find((tab) => tab.id === settingsTab)?.label }}
          </h3>
          <button
            class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
            :title="t('关闭', 'Close')"
            @click="settingsOpen = false"
          >
            <X :size="17" />
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6 text-sm">
          <template v-if="settingsTab === 'general'">
            <div class="settings-row">
              <div>
                <p class="font-medium">{{ t('界面语言', 'Language') }}</p>
              </div>
              <div class="settings-segment" role="radiogroup">
                <button
                  v-for="option in [
                    { value: 'zh', label: '中文' },
                    { value: 'en', label: 'English' },
                  ] as const"
                  :key="option.value"
                  role="radio"
                  :aria-checked="preferences.locale === option.value"
                  :class="preferences.locale === option.value ? 'is-active' : ''"
                  @click="preferences.locale = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <div class="settings-row">
              <div>
                <p class="font-medium">{{ t('外观', 'Appearance') }}</p>
                <p class="settings-hint">
                  {{
                    t(
                      '跟随系统时随 macOS / Windows 的深浅色自动切换',
                      'System follows the macOS / Windows setting',
                    )
                  }}
                </p>
              </div>
              <div class="settings-segment" role="radiogroup">
                <button
                  v-for="option in [
                    { value: 'light', label: t('浅色', 'Light') },
                    { value: 'dark', label: t('深色', 'Dark') },
                    { value: 'system', label: t('跟随系统', 'System') },
                  ] as const"
                  :key="option.value"
                  role="radio"
                  :aria-checked="preferences.appearance === option.value"
                  :class="preferences.appearance === option.value ? 'is-active' : ''"
                  @click="preferences.appearance = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <div class="settings-row">
              <div>
                <p class="font-medium">{{ t('Markdown 主题', 'Markdown theme') }}</p>
                <p class="settings-hint">
                  {{
                    t(
                      '排版模式使用的官方 Milkdown 主题',
                      'Official Milkdown theme for rendered mode',
                    )
                  }}
                </p>
              </div>
              <div class="settings-segment" role="radiogroup">
                <button
                  v-for="item in documentThemes"
                  :key="item.value"
                  role="radio"
                  :aria-checked="preferences.documentTheme === item.value"
                  :class="preferences.documentTheme === item.value ? 'is-active' : ''"
                  @click="preferences.documentTheme = item.value"
                >
                  {{ item.label }}
                </button>
              </div>
            </div>
            <div class="settings-row">
              <div>
                <p class="font-medium">{{ t('正文字号', 'Text size') }}</p>
                <p class="settings-hint">
                  {{ t('同时作用于排版和源代码模式', 'Applies to both editing modes') }}
                </p>
              </div>
              <div class="settings-segment" role="radiogroup">
                <button
                  v-for="scale in editorScales"
                  :key="scale"
                  role="radio"
                  :aria-checked="preferences.editorScale === scale"
                  :class="preferences.editorScale === scale ? 'is-active' : ''"
                  @click="preferences.editorScale = scale"
                >
                  {{ scaleLabel(scale) }}
                </button>
              </div>
            </div>
          </template>

          <template v-else-if="settingsTab === 'editor'">
            <label class="settings-row">
              <div>
                <p class="font-medium">{{ t('保存时自动格式化', 'Format on save') }}</p>
                <p class="settings-hint">
                  {{
                    t(
                      '只处理修改过的文档；无法安全格式化时保留原文',
                      'Only changed documents; the source is kept when formatting is not safe',
                    )
                  }}
                </p>
              </div>
              <input v-model="preferences.autoFormat" type="checkbox" class="settings-switch" />
            </label>
            <div class="settings-row">
              <div>
                <p class="font-medium">{{ t('新分栏打开方式', 'New split opens in') }}</p>
              </div>
              <div class="settings-segment" role="radiogroup">
                <button
                  v-for="option in [
                    { value: 'same', label: t('与当前栏相同', 'Same as current') },
                    { value: 'rendered', label: t('排版', 'Rendered') },
                    { value: 'source', label: t('源代码', 'Source') },
                  ] as const"
                  :key="option.value"
                  role="radio"
                  :aria-checked="preferences.newPaneMode === option.value"
                  :class="preferences.newPaneMode === option.value ? 'is-active' : ''"
                  @click="preferences.newPaneMode = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <div class="settings-row">
              <div>
                <p class="font-medium">{{ t('版本历史', 'Version history') }}</p>
                <p class="settings-hint">
                  {{
                    t(
                      '保存时自动保留旧版本（同一文档至少间隔 10 分钟，格式化、恢复和 AI 修改前必定保留），每篇最多 50 份，存放在项目的 .vivin/history 中。',
                      'Earlier versions are kept on save (at least 10 minutes apart; always before formatting, restoring and AI edits), up to 50 per document, in the project’s .vivin/history.',
                    )
                  }}
                </p>
              </div>
            </div>
          </template>

          <template v-else-if="settingsTab === 'shortcuts'">
            <div v-for="[group, list] in shortcutGroups" :key="group" class="mb-5">
              <p class="mb-1 text-xs font-semibold text-slate-500">{{ group }}</p>
              <div
                v-for="item in list"
                :key="item.title"
                class="flex items-center justify-between border-b border-slate-100 py-2"
              >
                <span>{{ item.title }}</span>
                <kbd>{{ item.shortcut }}</kbd>
              </div>
            </div>
            <p class="settings-hint">
              {{
                t('Esc 关闭弹窗、查找框和专注模式。', 'Esc closes dialogs, find and focus mode.')
              }}
            </p>
          </template>

          <template v-else>
            <div class="flex items-center gap-4 py-4">
              <img src="/vivin-logo.svg" alt="vivin" class="h-10 w-auto" />
              <div>
                <p class="text-xs text-slate-500">
                  {{ t('版本', 'Version') }} {{ appVersion || t('开发版', 'development') }}
                </p>
              </div>
            </div>
            <label class="settings-row">
              <div>
                <p class="font-medium">
                  {{ t('自动检查更新', 'Check for updates automatically') }}
                </p>
                <p class="settings-hint">
                  {{
                    t(
                      '每天最多查询一次 GitHub 上的最新版本，不上传任何内容',
                      'At most once a day; nothing is uploaded',
                    )
                  }}
                </p>
              </div>
              <input v-model="preferences.checkUpdates" type="checkbox" class="settings-switch" />
            </label>
            <div class="settings-row">
              <div>
                <p class="font-medium">{{ t('更新', 'Updates') }}</p>
                <p v-if="updateProgress !== null" class="settings-hint" role="status">
                  {{ progressLabel }}
                </p>
                <p v-else-if="availableUpdate" class="settings-hint">
                  {{
                    t(
                      `可更新到 ${availableUpdate.version}，更新前会保存全部文档。`,
                      `${availableUpdate.version} is available. All documents are saved first.`,
                    )
                  }}
                  <button
                    class="text-blue-600 hover:underline"
                    @click="openReleaseNotes(availableUpdate.version)"
                  >
                    {{ t('更新说明', 'Release notes') }}
                  </button>
                </p>
              </div>
              <div class="flex gap-2">
                <button
                  v-if="availableUpdate"
                  class="settings-button is-primary"
                  :disabled="updateProgress !== null"
                  @click="installUpdate"
                >
                  {{ t('更新并重启', 'Update and restart') }}
                </button>
                <button
                  class="settings-button"
                  :disabled="checkingUpdates || updateProgress !== null"
                  @click="checkForUpdates(true)"
                >
                  {{ checkingUpdates ? t('正在检查…', 'Checking…') : t('检查更新', 'Check now') }}
                </button>
              </div>
            </div>
            <div class="settings-row">
              <div>
                <p class="font-medium">{{ t('日志', 'Logs') }}</p>
                <p class="settings-hint">
                  {{ t('反馈问题时可附上日志文件', 'Attach the log when reporting a problem') }}
                </p>
              </div>
              <button class="settings-button" :disabled="!nativeAvailable()" @click="openLogs">
                {{ t('打开日志文件夹', 'Open log folder') }}
              </button>
            </div>
            <div class="settings-row is-stacked">
              <div>
                <p class="font-medium">
                  {{ t('本机 AI 连接（MCP）', 'Local AI connection (MCP)') }}
                </p>
                <p class="settings-hint">
                  {{
                    t(
                      '在 AI 客户端中添加以下地址，并按 bridge.json 中的令牌发送 Authorization: Bearer。请勿分享令牌。',
                      'Add this URL to your AI client and send the token from bridge.json as Authorization: Bearer. Never share the token.',
                    )
                  }}
                </p>
              </div>
              <div v-if="bridge" class="mt-2 space-y-1.5">
                <div class="settings-code">
                  <code>{{ bridge.url }}</code>
                  <button :title="t('复制', 'Copy')" @click="copy(bridge.url)">
                    <Copy :size="13" />
                  </button>
                </div>
                <div class="settings-code">
                  <code>{{ bridge.configPath }}</code>
                  <button :title="t('复制', 'Copy')" @click="copy(bridge.configPath)">
                    <Copy :size="13" />
                  </button>
                </div>
              </div>
              <p v-else class="settings-hint mt-2">
                {{ t('仅在桌面应用中可用', 'Available in the desktop app') }}
              </p>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
