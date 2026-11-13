<script setup lang="ts">
import { FileText, Search, TextSearch } from '@lucide/vue';
import { computed, nextTick, ref, watch } from 'vue';
import { fuzzyMatch, rankPaths } from '../../lib/fuzzy-match';
import { t } from '../../lib/i18n';
import { documentPaths } from '../project/use-project';
import { openProjectSearch } from '../search/use-project-search';
import { palette, shortcutLabel } from '../workspace/use-layout';
import { openBeside, openDoc, recentDocuments } from '../workspace/use-panes';
import { commands, runCommand, type Command } from './use-commands';

type Item =
  | { kind: 'file'; key: string; path: string; positions: number[] }
  | { kind: 'search'; key: string; text: string }
  | { kind: 'command'; key: string; command: Command };

const input = ref<HTMLInputElement>();
const list = ref<HTMLElement>();
const selected = ref(0);
const limit = 60;

const mode = computed(() =>
  palette.value?.mode === 'commands' || palette.value?.query.startsWith('>') ? 'commands' : 'files',
);
const text = computed(() => (palette.value?.query ?? '').replace(/^>\s*/, '').trim());

const items = computed<Item[]>(() => {
  if (!palette.value) return [];
  if (mode.value === 'commands') {
    return commands.value
      .filter((command) => !command.enabled || command.enabled())
      .map((command) => ({
        command,
        match: fuzzyMatch(text.value, `${command.group} ${command.title}`),
      }))
      .filter((entry) => entry.match)
      .sort((left, right) => (right.match?.score ?? 0) - (left.match?.score ?? 0))
      .map(({ command }) => ({ kind: 'command' as const, key: command.id, command }));
  }
  const files: Item[] = rankPaths(text.value, documentPaths.value, recentDocuments.value)
    .slice(0, limit)
    .map((match) => ({
      kind: 'file',
      key: match.path,
      path: match.path,
      positions: match.positions,
    }));
  if (text.value) files.push({ kind: 'search', key: 'search', text: text.value });
  return files;
});

watch(
  () => palette.value !== null,
  async (open) => {
    if (!open) return;
    selected.value = 0;
    await nextTick();
    input.value?.focus();
    input.value?.select();
  },
  { immediate: true },
);
watch(items, () => (selected.value = 0));

function segments(path: string, positions: number[]) {
  const hit = new Set(positions);
  const parts: { text: string; match: boolean }[] = [];
  for (let index = 0; index < path.length; index++) {
    const match = hit.has(index);
    const last = parts[parts.length - 1];
    if (last && last.match === match) last.text += path[index];
    else parts.push({ text: path[index] ?? '', match });
  }
  return parts;
}

function close() {
  palette.value = null;
}

function choose(item: Item | undefined, beside = false) {
  if (!item) return;
  close();
  if (item.kind === 'file') void (beside ? openBeside(item.path) : openDoc(item.path));
  else if (item.kind === 'search') void openProjectSearch(item.text);
  else runCommand(item.command);
}

function move(step: number) {
  const count = items.value.length;
  if (!count) return;
  selected.value = (selected.value + step + count) % count;
  void nextTick(() =>
    list.value
      ?.querySelector(`[data-index="${selected.value}"]`)
      ?.scrollIntoView({ block: 'nearest' }),
  );
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    move(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    move(-1);
  } else if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    choose(items.value[selected.value], event.metaKey || event.ctrlKey);
  }
}

const placeholder = computed(() =>
  mode.value === 'commands'
    ? t('输入命令名称…', 'Type a command…')
    : t('输入文档名称，或输入 > 执行命令', 'Type a document name, or > for commands'),
);
</script>

<template>
  <div
    v-if="palette"
    class="fixed inset-0 z-[110] flex items-start justify-center bg-slate-950/20 pt-[12vh]"
    @click.self="close"
  >
    <div
      class="command-palette flex max-h-[min(520px,70vh)] w-[min(600px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      role="dialog"
      aria-modal="true"
      :aria-label="
        mode === 'commands' ? t('命令面板', 'Command palette') : t('快速打开', 'Quick open')
      "
      @click.stop
    >
      <label class="flex shrink-0 items-center gap-2.5 border-b border-slate-100 px-4 py-3">
        <Search :size="17" class="shrink-0 text-slate-400" />
        <input
          ref="input"
          v-model="palette.query"
          class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          :placeholder="placeholder"
          role="combobox"
          aria-expanded="true"
          aria-controls="vivin-palette-list"
          :aria-activedescendant="items[selected] ? `vivin-palette-${selected}` : undefined"
          @keydown="onKeydown"
        />
      </label>
      <div id="vivin-palette-list" ref="list" class="min-h-0 overflow-y-auto p-1.5" role="listbox">
        <p v-if="!items.length" class="px-3 py-6 text-center text-sm text-slate-400">
          {{
            mode === 'commands'
              ? t('没有匹配的命令', 'No matching commands')
              : t('没有匹配的文档', 'No matching documents')
          }}
        </p>
        <button
          v-for="(item, index) in items"
          :id="`vivin-palette-${index}`"
          :key="item.key"
          :data-index="index"
          class="palette-item flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm"
          :class="index === selected ? 'is-selected' : ''"
          role="option"
          :aria-selected="index === selected"
          @mousemove="selected = index"
          @click="choose(item, $event.metaKey || $event.ctrlKey)"
        >
          <template v-if="item.kind === 'file'">
            <FileText :size="15" class="shrink-0 text-slate-400" />
            <span class="min-w-0 flex-1 truncate">
              <template
                v-for="(part, partIndex) in segments(item.path, item.positions)"
                :key="partIndex"
              >
                <mark v-if="part.match" class="palette-match">{{ part.text }}</mark
                ><template v-else>{{ part.text }}</template>
              </template>
            </span>
            <span
              v-if="!text && recentDocuments.includes(item.path)"
              class="shrink-0 text-[11px] text-slate-400"
              >{{ t('最近', 'Recent') }}</span
            >
          </template>
          <template v-else-if="item.kind === 'search'">
            <TextSearch :size="15" class="shrink-0 text-slate-400" />
            <span class="min-w-0 flex-1 truncate">
              {{ t(`在项目全文中搜索“${item.text}”`, `Search all documents for “${item.text}”`) }}
            </span>
          </template>
          <template v-else>
            <span class="w-14 shrink-0 text-[11px] text-slate-400">{{ item.command.group }}</span>
            <span class="min-w-0 flex-1 truncate">{{ item.command.title }}</span>
            <kbd v-if="item.command.shortcut" class="shrink-0">{{
              shortcutLabel(item.command.shortcut)
            }}</kbd>
          </template>
        </button>
      </div>
      <div
        class="flex shrink-0 gap-4 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400"
      >
        <span>↑↓ {{ t('选择', 'Select') }}</span>
        <span>↵ {{ t('打开', 'Open') }}</span>
        <span v-if="mode === 'files'"
          >{{ shortcutLabel('mod') }}↵ {{ t('在旁边打开', 'Open beside') }}</span
        >
        <span>Esc {{ t('关闭', 'Close') }}</span>
      </div>
    </div>
  </div>
</template>
