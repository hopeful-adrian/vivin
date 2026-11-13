import { ref } from 'vue';

export type Locale = 'zh' | 'en';

/** Interface language shared by every component; persisted by the preferences store. */
export const locale = ref<Locale>('zh');

export function t(zh: string, en: string): string {
  return locale.value === 'zh' ? zh : en;
}
