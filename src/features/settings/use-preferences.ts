import { computed, reactive, ref, watch } from 'vue';
import { locale } from '../../lib/i18n';
import { parsePreferences, preferenceKeys, readStoredJson, type Preferences } from './preferences';

const preferences = reactive<Preferences>(
  parsePreferences((key) => readStoredJson(localStorage, key)),
);
const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches);
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', (event) => (systemDark.value = event.matches));

locale.value = preferences.locale;
for (const key of Object.keys(preferenceKeys) as (keyof Preferences)[])
  watch(
    () => preferences[key],
    (value) => {
      localStorage.setItem(preferenceKeys[key], JSON.stringify(value));
      if (key === 'locale') locale.value = preferences.locale;
    },
  );

const theme = computed<'light' | 'dark'>(() =>
  preferences.appearance === 'system'
    ? systemDark.value
      ? 'dark'
      : 'light'
    : preferences.appearance,
);

/** Machine-local preferences shared by the whole window. */
export function usePreferences() {
  return { preferences, theme };
}

export function readLocalJson(key: string): unknown {
  return readStoredJson(localStorage, key);
}

export function writeLocalJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}
