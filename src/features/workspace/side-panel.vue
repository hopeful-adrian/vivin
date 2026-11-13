<script setup lang="ts">
import { History, Pencil, Plus, RotateCcw, Trash2, X } from '@lucide/vue';
import { computed } from 'vue';
import EmptyPanel from '../../components/empty-panel.vue';
import LoadingState from '../../components/loading-state.vue';
import { locale, t } from '../../lib/i18n';
import {
  annotationFilter,
  annotationKinds,
  kindColor,
  kindLabel,
  needsRelocation,
} from '../annotations/use-annotations';
import {
  historyEntries,
  historyLoading,
  historyPath,
  previewVersion,
  reasonLabel,
  restoreSelectedVersion,
  selectedVersion,
} from '../history/use-history';
import { data, lockSource } from '../project/use-project';
import {
  hits,
  query,
  runSearch,
  searchRan,
  searchedQuery,
  searching,
} from '../search/use-project-search';
import { editTerm, focusedTermId, removeTerm, restoreTermException } from '../terms/use-terms';
import { panel, readingPanel } from './use-layout';
import { jumpTo } from './use-panes';

const titles = computed(() => ({
  none: '',
  search: t('项目搜索', 'Project search'),
  terms: t('项目术语', 'Project terms'),
  annotations: t('项目标注', 'Project annotations'),
  history: t('版本历史', 'Version history'),
}));

const filteredAnnotations = computed(() =>
  data.value.annotations.filter((item) => item.kind === annotationFilter.value),
);

function formatTime(value: number): string {
  return new Date(value).toLocaleString(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** Splits an excerpt around the searched text so the match can be highlighted. */
function excerptParts(excerpt: string): { text: string; match: boolean }[] {
  const needle = searchedQuery.value.toLowerCase();
  if (!needle) return [{ text: excerpt, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  const lower = excerpt.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
    if (at > from) parts.push({ text: excerpt.slice(from, at), match: false });
    parts.push({ text: excerpt.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < excerpt.length) parts.push({ text: excerpt.slice(from), match: false });
  return parts;
}
</script>

<template>
  <aside
    :class="[readingPanel ? 'ml-2.5 min-w-0 flex-1' : 'ml-2.5 w-80 shrink-0']"
    class="side-panel flex flex-col overflow-hidden rounded-2xl bg-white"
  >
    <div
      :class="readingPanel ? 'h-11 px-6 font-medium' : 'h-12 px-4 font-semibold'"
      class="flex shrink-0 items-center justify-between text-sm"
    >
      <span>{{ titles[panel] }}</span>
      <button
        class="rounded p-1 hover:bg-slate-100"
        :title="t('关闭面板', 'Close panel')"
        @click.stop="panel = 'none'"
      >
        <X :size="16" />
      </button>
    </div>

    <div v-if="panel === 'search'" class="min-h-0 overflow-y-auto p-3">
      <form class="flex gap-2" @submit.prevent="runSearch">
        <input
          id="vivin-project-search"
          v-model="query"
          :placeholder="t('搜索全部 Markdown 正文', 'Search all Markdown content')"
          class="min-w-0 flex-1 rounded-lg bg-slate-100 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
        /><button class="rounded-lg bg-blue-600 px-3 text-xs text-white hover:bg-blue-700">
          {{ t('搜索', 'Search') }}
        </button>
      </form>
      <LoadingState v-if="searching" :label="t('正在搜索…', 'Searching…')" />
      <EmptyPanel
        v-else-if="!query.trim()"
        :label="
          t(
            '输入关键词，搜索当前项目的 Markdown 文档。',
            'Enter keywords to search Markdown documents in this project.',
          )
        "
      />
      <EmptyPanel
        v-else-if="!searchRan"
        :label="t('按回车或点击搜索查看结果。', 'Press Enter or click Search to see results.')"
      />
      <EmptyPanel
        v-else-if="hits.length === 0"
        :label="t('没有找到匹配的内容。', 'No matching content found.')"
      />
      <template v-else>
        <p class="mt-3 px-1 text-xs text-slate-400">
          {{ t(`共 ${hits.length} 处结果`, `${hits.length} results`) }}
        </p>
        <button
          v-for="hit in hits"
          :key="`${hit.path}:${hit.offset}`"
          class="mt-2 block w-full rounded-lg p-2 text-left hover:bg-slate-50"
          @click.stop="jumpTo(hit.path, hit.offset, searchedQuery.length)"
        >
          <div class="text-xs font-medium text-blue-600">{{ hit.path }}</div>
          <div class="mt-1 line-clamp-2 text-xs text-slate-600">
            <template v-for="(part, partIndex) in excerptParts(hit.excerpt)" :key="partIndex">
              <mark v-if="part.match" class="search-hit">{{ part.text }}</mark
              ><template v-else>{{ part.text }}</template>
            </template>
          </div>
        </button>
      </template>
    </div>

    <div v-else-if="panel === 'terms'" class="min-h-0 flex-1 overflow-y-auto px-8 py-7">
      <div class="reading-page mx-auto max-w-[860px]">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <h1>{{ t('项目术语', 'Project terms') }}</h1>
          <button
            class="mt-8 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-blue-600 hover:bg-blue-50"
            @click.stop="editTerm()"
          >
            <Plus :size="16" />{{ t('新建术语', 'New term') }}
          </button>
        </div>
        <EmptyPanel
          v-if="data.terms.length === 0"
          :label="
            t(
              '还没有术语。新建后，在文档中悬停同名词语即可查看解释。',
              'No terms yet. Create one, then hover over matching words in a document.',
            )
          "
        />
        <section
          v-for="term in data.terms"
          :id="`term-${term.id}`"
          :key="term.id"
          class="group mb-10 scroll-mt-10"
        >
          <div class="flex items-start justify-between gap-4">
            <h2 :class="focusedTermId === term.id ? 'text-blue-700' : ''">{{ term.name }}</h2>
            <div class="flex shrink-0 items-center gap-1 text-slate-500">
              <button
                class="rounded-md p-1.5 hover:bg-slate-100"
                :title="t('编辑术语', 'Edit term')"
                @click.stop="editTerm(term)"
              >
                <Pencil :size="15" />
              </button>
              <button
                class="rounded-md p-1.5 text-rose-600 hover:bg-slate-100"
                :title="t('删除术语', 'Delete term')"
                @click.stop="removeTerm(term.id)"
              >
                <Trash2 :size="15" />
              </button>
            </div>
          </div>
          <p class="mt-3 text-base leading-8 whitespace-pre-wrap text-slate-600">
            {{ term.definition }}
          </p>
          <div
            v-for="exception in data.termExceptions.filter((item) => item.termId === term.id)"
            :key="exception.id"
            class="mt-3 text-sm leading-6 text-slate-500"
          >
            {{ exception.document }} · {{ t('此处已关闭解释', 'Definition hidden here') }}
            <button class="ml-2 text-blue-600" @click.stop="restoreTermException(exception)">
              {{ t('恢复', 'Restore') }}
            </button>
          </div>
        </section>
      </div>
    </div>

    <div v-else-if="panel === 'annotations'" class="min-h-0 overflow-y-auto p-3">
      <div class="mb-3 flex gap-1">
        <button
          v-for="kind in annotationKinds"
          :key="kind.value"
          :class="[
            'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
            annotationFilter === kind.value ? 'bg-blue-600 text-white' : 'bg-slate-100',
          ]"
          :aria-pressed="annotationFilter === kind.value"
          @click.stop="annotationFilter = kind.value"
        >
          <i class="h-1.5 w-1.5 rounded-full" :style="{ background: kind.color }" />{{
            kindLabel(kind.value)
          }}
        </button>
      </div>
      <EmptyPanel
        v-if="filteredAnnotations.length === 0"
        :label="
          t(
            '暂无此类型标注。在文档中选中文字后，可从弹出的工具条添加。',
            'No annotations of this type. Select text in a document and use the toolbar that appears.',
          )
        "
      />
      <button
        v-for="annotation in filteredAnnotations"
        :key="annotation.id"
        class="mb-2 block w-full rounded-xl bg-slate-50 p-3 text-left hover:bg-slate-100"
        @click.stop="
          jumpTo(annotation.document, annotation.offset, annotation.quote.length, annotation.id)
        "
      >
        <div class="flex items-center gap-1.5 text-xs font-medium text-blue-600">
          <i class="h-1.5 w-1.5 rounded-full" :style="{ background: kindColor(annotation.kind) }" />
          {{ annotation.document }}
        </div>
        <div class="mt-1 line-clamp-2 text-sm">{{ annotation.quote }}</div>
        <div v-if="annotation.note" class="mt-1 line-clamp-3 text-xs text-slate-500">
          {{ annotation.note }}
        </div>
        <div v-if="needsRelocation(annotation)" class="mt-1 text-xs text-amber-700">
          {{ t('原文已改动，需重新定位', 'The text changed; needs relocation') }}
        </div>
      </button>
    </div>

    <div v-else-if="panel === 'history'" class="flex min-h-0 flex-1 flex-col">
      <p v-if="historyPath" class="truncate px-4 pb-2 text-xs text-slate-400" :title="historyPath">
        {{ historyPath }}
      </p>
      <LoadingState v-if="historyLoading" :label="t('正在读取版本…', 'Loading versions…')" />
      <EmptyPanel
        v-else-if="!historyPath"
        :label="t('打开一篇文档后查看它的版本历史。', 'Open a document to see its versions.')"
      />
      <EmptyPanel
        v-else-if="historyEntries.length === 0"
        :label="
          t(
            '还没有保存过的旧版本。修改并保存后，旧内容会自动保留在这里（最近 50 份）。',
            'No earlier versions yet. After you edit and save, previous content is kept here (up to 50).',
          )
        "
      />
      <template v-else>
        <div
          class="min-h-0 overflow-y-auto px-3"
          :class="selectedVersion ? 'max-h-[40%]' : 'flex-1'"
        >
          <button
            v-for="entry in historyEntries"
            :key="entry.id"
            class="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50"
            :class="selectedVersion?.entry.id === entry.id ? 'bg-blue-50 text-blue-700' : ''"
            @click.stop="previewVersion(entry)"
          >
            <History :size="14" class="shrink-0 text-slate-400" />
            <span class="min-w-0 flex-1">
              <span class="block">{{ formatTime(entry.createdAt) }}</span>
              <span class="block text-[11px] text-slate-400"
                >{{ reasonLabel(entry.reason) }} · {{ formatSize(entry.size) }}</span
              >
            </span>
          </button>
        </div>
        <div
          v-if="selectedVersion"
          class="flex min-h-0 flex-1 flex-col border-t border-slate-100 p-3"
        >
          <div class="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500">
            <span
              >{{ t('预览', 'Preview') }} · {{ formatTime(selectedVersion.entry.createdAt) }}</span
            >
            <button
              class="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="!!(historyPath && lockSource(historyPath))"
              @click.stop="restoreSelectedVersion"
            >
              <RotateCcw :size="13" />{{ t('恢复此版本', 'Restore') }}
            </button>
          </div>
          <pre
            class="history-preview min-h-0 flex-1 overflow-auto rounded-lg bg-slate-50 p-3 text-xs leading-5 whitespace-pre-wrap"
            >{{ selectedVersion.content }}</pre>
        </div>
      </template>
    </div>
  </aside>
</template>
