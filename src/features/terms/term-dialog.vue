<script setup lang="ts">
import { t } from '../../lib/i18n';
import { saveTermDialog, termDialog } from './use-terms';
</script>

<template>
  <div
    v-if="termDialog"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/30"
    @click.self="termDialog = null"
  >
    <div
      class="w-[min(520px,calc(100vw-32px))] rounded-2xl bg-white p-5 shadow-2xl"
      role="dialog"
      aria-modal="true"
      :aria-label="t('编辑项目术语', 'Edit project term')"
      @click.stop
    >
      <h2 class="text-base font-semibold">
        {{ termDialog.id ? t('编辑术语', 'Edit term') : t('新建术语', 'New term') }}
      </h2>
      <label class="mt-4 block text-sm text-slate-600" for="vivin-term-name">
        {{ t('术语名称', 'Term name') }}
      </label>
      <input
        id="vivin-term-name"
        v-model="termDialog.name"
        class="mt-1 w-full rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
        @keydown.esc.stop="termDialog = null"
      />
      <label class="mt-4 block text-sm text-slate-600" for="vivin-term-definition">
        {{ t('解释', 'Definition') }}
      </label>
      <textarea
        id="vivin-term-definition"
        v-model="termDialog.definition"
        rows="7"
        class="mt-1 w-full resize-y rounded-lg bg-slate-100 px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-blue-200"
        @keydown.esc.stop="termDialog = null"
      />
      <div class="mt-5 flex justify-end gap-2 text-sm">
        <button class="rounded-lg px-3 py-1.5 hover:bg-slate-100" @click.stop="termDialog = null">
          {{ t('取消', 'Cancel') }}
        </button>
        <button
          class="rounded-lg bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="!termDialog.name.trim()"
          @click.stop="saveTermDialog"
        >
          {{ t('保存', 'Save') }}
        </button>
      </div>
    </div>
  </div>
</template>
