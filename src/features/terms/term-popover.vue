<script setup lang="ts">
import { t } from '../../lib/i18n';
import { openProjectResource } from '../../lib/project-api';
import { report } from '../ui/use-toast';
import {
  disableTermHere,
  hoveredTerm,
  hoveredTermDetail,
  keepTerm,
  scheduleHideTerm,
  viewTerm,
} from './use-terms';

function openSource(path: string) {
  void openProjectResource(path).catch(report);
}
</script>

<template>
  <div
    v-if="hoveredTerm"
    id="vivin-term-popover"
    class="fixed z-40 flex max-h-[min(420px,calc(100vh-24px))] w-[420px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl bg-white p-3 text-sm shadow-xl"
    :style="{ left: `${hoveredTerm.x}px`, top: `${hoveredTerm.y}px` }"
    @mouseenter="keepTerm"
    @mouseleave="scheduleHideTerm"
    @click.stop
  >
    <div class="shrink-0 font-semibold break-words">{{ hoveredTerm.term.name }}</div>
    <button
      v-if="hoveredTermDetail.source"
      class="mt-1 shrink-0 text-left text-xs leading-5 break-all text-blue-600 hover:underline"
      :title="t('使用系统默认程序打开原件', 'Open the original with the default app')"
      @click="openSource(hoveredTermDetail.source)"
    >
      {{ t('打开原件：', 'Open source: ') }}{{ hoveredTermDetail.source.split('/').pop() }}
    </button>
    <p
      class="mt-1 min-h-0 flex-auto overflow-x-hidden overflow-y-auto overscroll-contain text-xs leading-5 break-words whitespace-pre-wrap text-slate-600 [overflow-wrap:anywhere]"
    >
      {{ hoveredTermDetail.body }}
    </p>
    <div class="mt-3 flex gap-3 text-xs text-blue-600">
      <button @click.stop="viewTerm(hoveredTerm.term)">{{ t('查看术语', 'View term') }}</button>
      <button v-if="hoveredTerm.offset !== null" @click.stop="disableTermHere">
        {{ t('关闭此处解释', 'Hide definition here') }}
      </button>
    </div>
  </div>
</template>
