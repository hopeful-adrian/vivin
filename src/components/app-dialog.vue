<script setup lang="ts">
import { t } from '../lib/i18n';
import { dialog, finishDialog } from '../features/ui/use-dialog';
</script>

<template>
  <div
    v-if="dialog"
    class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/30"
    @click.self="finishDialog(false)"
  >
    <div
      class="w-[min(420px,calc(100vw-32px))] rounded-2xl bg-white p-5 shadow-2xl"
      role="dialog"
      aria-modal="true"
      :aria-label="dialog.title"
      @click.stop
    >
      <h2 class="text-base font-semibold">{{ dialog.title }}</h2>
      <p v-if="dialog.message" class="mt-2 text-sm leading-6 text-slate-500">
        {{ dialog.message }}
      </p>
      <input
        v-if="dialog.kind === 'text'"
        id="vivin-dialog-input"
        v-model="dialog.value"
        class="mt-4 w-full rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
        @keydown.enter.stop.prevent="finishDialog(true)"
        @keydown.esc.stop="finishDialog(false)"
      />
      <div class="mt-5 flex justify-end gap-2 text-sm">
        <button class="rounded-lg px-3 py-1.5 hover:bg-slate-100" @click="finishDialog(false)">
          {{ t('取消', 'Cancel') }}
        </button>
        <button
          :id="dialog.kind === 'confirm' ? 'vivin-dialog-input' : undefined"
          class="rounded-lg px-3 py-1.5 text-white"
          :class="dialog.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'"
          @click="finishDialog(true)"
        >
          {{ dialog.confirmLabel || t('确定', 'Confirm') }}
        </button>
      </div>
    </div>
  </div>
</template>
