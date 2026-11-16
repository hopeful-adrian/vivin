<script setup lang="ts">
import { Maximize, Minus, Plus, X } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';

const props = defineProps<{ svg: string; locale?: 'zh' | 'en' }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const zoom = ref(1);
// Images decode SVG as strict XML, so HTML-serialized labels such as `<br>` must be re-serialized.
const imageSource = computed(() => {
  const svg = new DOMParser().parseFromString(props.svg, 'text/html').querySelector('svg');
  return svg
    ? `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
    : '';
});
onMounted(() => dialog.value?.showModal());
</script>

<template>
  <dialog
    ref="dialog"
    class="diagram-dialog"
    :aria-label="locale === 'en' ? 'Diagram viewer' : '图表查看器'"
    @close="emit('close')"
    @click="$event.target === dialog && dialog?.close()"
  >
    <div class="diagram-dialog-body">
      <div class="diagram-toolbar">
        <span class="flex-1 font-medium">{{ locale === 'en' ? 'Diagram' : '图表' }}</span>
        <button
          :disabled="zoom <= 0.1"
          :aria-label="locale === 'en' ? 'Zoom out' : '缩小'"
          @click="zoom = Math.max(0.1, Math.round((zoom - 0.1) * 100) / 100)"
        >
          <Minus :size="16" />
        </button>
        <input
          class="w-16 text-center text-xs"
          type="number"
          min="10"
          max="300"
          step="10"
          :value="Math.round(zoom * 100)"
          :aria-label="locale === 'en' ? 'Zoom percent' : '缩放百分比'"
          @change="
            zoom = Math.max(
              0.1,
              Math.min(3, (Number(($event.target as HTMLInputElement).value) || 100) / 100),
            )
          "
        />
        <span>%</span>
        <button
          :disabled="zoom >= 3"
          :aria-label="locale === 'en' ? 'Zoom in' : '放大'"
          @click="zoom = Math.min(3, Math.round((zoom + 0.1) * 100) / 100)"
        >
          <Plus :size="16" />
        </button>
        <button :title="locale === 'en' ? 'Fit to width' : '适应宽度'" @click="zoom = 1">
          <Maximize :size="16" />
        </button>
        <button autofocus :aria-label="locale === 'en' ? 'Close' : '关闭'" @click="dialog?.close()">
          <X :size="18" />
        </button>
      </div>
      <div class="diagram-viewport">
        <!-- An image document isolates SVG IDs from the inline diagram. -->
        <div class="diagram-zoom" :style="{ width: `${zoom * 100}%` }">
          <img :src="imageSource" :alt="locale === 'en' ? 'Expanded diagram' : '放大的图表'" />
        </div>
      </div>
    </div>
  </dialog>
</template>
