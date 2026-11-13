import { ref } from 'vue';
import { errorMessage } from '../../lib/app-error';
import { locale } from '../../lib/i18n';
import { writeLog } from '../../lib/app-log';

export type ToastLevel = 'success' | 'info' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  run(): unknown;
}

export interface Toast {
  id: number;
  level: ToastLevel;
  text: string;
  action?: ToastAction;
}

const lifetimes: Record<ToastLevel, number> = {
  success: 3500,
  info: 4500,
  warning: 10_000,
  error: 0,
};

let nextId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
export const toasts = ref<Toast[]>([]);

export function dismiss(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

/** Success and info messages disappear on their own; errors stay until dismissed. */
export function notify(text: string, level: ToastLevel = 'info', action?: ToastAction): number {
  for (const toast of toasts.value) if (toast.text === text) dismiss(toast.id);
  const id = nextId++;
  toasts.value = [...toasts.value.slice(-3), { id, level, text, action }];
  const lifetime = lifetimes[level];
  if (lifetime)
    timers.set(
      id,
      setTimeout(() => dismiss(id), lifetime),
    );
  return id;
}

export function report(error: unknown, action?: ToastAction) {
  writeLog('error', errorMessage(error));
  notify(errorMessage(error, locale.value), 'error', action);
}
