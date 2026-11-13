<script setup lang="ts">
import { FilePlus2, FileText, FolderOpen, Plus } from '@lucide/vue';
import { computed } from 'vue';
import { t } from '../../lib/i18n';
import { busy, documentPaths, project, recentProjects } from '../project/use-project';
import { addDoc, switchProject } from '../project/use-project-actions';
import { openPalette, shortcutLabel } from './use-layout';
import { openDoc, recentDocuments } from './use-panes';

const recentDocs = computed(() =>
  recentDocuments.value.filter((path) => documentPaths.value.includes(path)).slice(0, 6),
);
</script>

<template>
  <div class="welcome-view flex flex-1 items-center justify-center overflow-y-auto px-8 py-10">
    <div v-if="!project" class="w-full max-w-md text-center">
      <img src="/vivin-logo.svg" alt="vivin" class="mx-auto mb-6 h-14 w-auto" />
      <h1 class="text-xl font-semibold tracking-tight">{{ t('开始写作', 'Start writing') }}</h1>
      <p class="mt-2 text-sm leading-6 text-slate-500">
        {{
          t(
            '选择一个文件夹作为项目。文档都是普通的 .md 文件，可以用任何编辑器打开。',
            'Pick a folder as your project. Documents are plain .md files any editor can open.',
          )
        }}
      </p>
      <div class="mt-6 flex justify-center gap-3">
        <button
          class="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          :disabled="busy"
          @click.stop="switchProject(true)"
        >
          <Plus :size="16" />{{ t('新建项目', 'New project') }}
        </button>
        <button
          class="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium hover:bg-slate-200/70 disabled:opacity-50"
          :disabled="busy"
          @click.stop="switchProject(false)"
        >
          <FolderOpen :size="16" />{{ t('打开文件夹', 'Open folder') }}
        </button>
      </div>
      <div v-if="recentProjects.length" class="mt-10 text-left">
        <p class="px-3 pb-2 text-xs font-semibold text-slate-500">
          {{ t('最近项目', 'Recent projects') }}
        </p>
        <button
          v-for="recent in recentProjects.slice(0, 5)"
          :key="recent.path"
          class="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100 disabled:opacity-50"
          :title="recent.path"
          :disabled="busy"
          @click.stop="switchProject(false, recent.path)"
        >
          <span class="block truncate text-sm font-medium">{{ recent.name }}</span>
          <span class="block truncate text-[11px] text-slate-400">{{ recent.path }}</span>
        </button>
      </div>
    </div>
    <div v-else-if="documentPaths.length === 0" class="max-w-xs text-center">
      <img src="/empty-writing.svg" alt="" class="mx-auto mb-5 h-44 w-60 object-contain" />
      <h1 class="text-lg font-semibold tracking-tight">
        {{ t('项目里还没有文档', 'No documents in this project') }}
      </h1>
      <p class="mt-2 text-sm leading-6 text-slate-500">
        {{
          t(
            '新建一篇 Markdown 文档，内容会保存在项目文件夹中。',
            'Create a Markdown document. It will be saved in the project folder.',
          )
        }}
      </p>
      <button
        class="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        @click.stop="addDoc()"
      >
        <FilePlus2 :size="16" />{{ t('新建文档', 'New document') }}
      </button>
    </div>
    <div v-else class="w-full max-w-sm text-center">
      <img src="/empty-writing.svg" alt="" class="mx-auto mb-5 h-36 w-52 object-contain" />
      <h1 class="text-lg font-semibold tracking-tight">
        {{ t('选择一篇文档', 'Choose a document') }}
      </h1>
      <p class="mt-2 text-sm leading-6 text-slate-500">
        {{ t('从左侧选择，或按', 'Pick one on the left, or press') }}
        <button class="welcome-kbd" @click.stop="openPalette('files')">
          {{ shortcutLabel('mod+p') }}
        </button>
        {{ t('快速打开。', 'to jump to one.') }}
      </p>
      <div v-if="recentDocs.length" class="mt-6 text-left">
        <p class="px-3 pb-1 text-xs font-semibold text-slate-500">
          {{ t('最近打开', 'Recently opened') }}
        </p>
        <button
          v-for="path in recentDocs"
          :key="path"
          class="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-slate-100"
          :title="path"
          @click.stop="openDoc(path)"
        >
          <FileText :size="15" class="shrink-0 text-slate-400" />
          <span class="min-w-0 truncate">{{ path }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
