<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from '@lucide/vue';
import { t } from '../lib/i18n';
import { dismiss, toasts, type Toast } from '../features/ui/use-toast';

const icons = { success: CircleCheck, info: Info, warning: TriangleAlert, error: CircleAlert };
const tones = {
  success: 'text-emerald-400',
  info: 'text-sky-300',
  warning: 'text-amber-300',
  error: 'text-rose-300',
};

function act(toast: Toast) {
  dismiss(toast.id);
  void toast.action?.run();
}
</script>

<template>
  <div
    class="pointer-events-none fixed right-5 bottom-5 z-[130] flex w-96 max-w-[calc(100vw-40px)] flex-col gap-2"
  >
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="app-toast pointer-events-auto flex items-start gap-2.5 rounded-xl bg-slate-800 px-3.5 py-2.5 text-xs leading-5 text-white shadow-xl"
        :role="toast.level === 'error' || toast.level === 'warning' ? 'alert' : 'status'"
      >
        <component
          :is="icons[toast.level]"
          :size="16"
          class="mt-0.5 shrink-0"
          :class="tones[toast.level]"
        />
        <span class="min-w-0 flex-1 break-words">{{ toast.text }}</span>
        <button
          v-if="toast.action"
          class="shrink-0 rounded-md bg-white/10 px-2 py-0.5 font-medium hover:bg-white/20"
          @click="act(toast)"
        >
          {{ toast.action.label }}
        </button>
        <button
          class="shrink-0 rounded p-0.5 text-white/60 hover:bg-white/15 hover:text-white"
          :title="t('关闭提示', 'Dismiss')"
          :aria-label="t('关闭提示', 'Dismiss')"
          @click="dismiss(toast.id)"
        >
          <X :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
