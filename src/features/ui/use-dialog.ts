import { nextTick, ref } from 'vue';

export interface DialogOptions {
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

export interface DialogState extends DialogOptions {
  kind: 'text' | 'confirm';
  title: string;
  value: string;
}

export const dialog = ref<DialogState | null>(null);
let resolveDialog: ((value: string | boolean | null) => void) | null = null;

export function finishDialog(accepted: boolean) {
  const active = dialog.value;
  dialog.value = null;
  const resolve = resolveDialog;
  resolveDialog = null;
  if (active?.kind === 'text') resolve?.(accepted ? active.value : null);
  else resolve?.(accepted);
}

function show(state: DialogState) {
  // A new request cancels the one still on screen.
  if (dialog.value) finishDialog(false);
  return new Promise<string | boolean | null>((resolve) => {
    dialog.value = state;
    resolveDialog = resolve;
    void nextTick(() => document.getElementById('vivin-dialog-input')?.focus());
  });
}

export async function requestText(
  title: string,
  value = '',
  options: DialogOptions = {},
): Promise<string | null> {
  const result = await show({ kind: 'text', title, value, ...options });
  return typeof result === 'string' ? result : null;
}

export async function confirmAction(title: string, options: DialogOptions = {}): Promise<boolean> {
  return (await show({ kind: 'confirm', title, value: '', ...options })) === true;
}
