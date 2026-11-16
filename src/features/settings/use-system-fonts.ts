import { ref } from 'vue';
import { listSystemFonts, nativeAvailable, type FontFamily } from '../../lib/project-api';
import { report } from '../ui/use-toast';

/** Shown outside the desktop app, where installed fonts cannot be listed. */
const browserFonts: FontFamily[] = [
  'Arial',
  'Georgia',
  'Helvetica Neue',
  'Menlo',
  'Microsoft YaHei',
  'PingFang SC',
  'Songti SC',
  'Times New Roman',
].map((family) => ({ family, localized: null }));

export const systemFonts = ref<FontFamily[]>([]);
export const loadingFonts = ref(false);
let loaded: Promise<void> | undefined;

/** Lists installed font families once per window, when Settings first needs them. */
export function loadSystemFonts(): Promise<void> {
  loaded ??= (async () => {
    if (!nativeAvailable()) {
      systemFonts.value = browserFonts;
      return;
    }
    loadingFonts.value = true;
    try {
      systemFonts.value = await listSystemFonts();
    } catch (error) {
      loaded = undefined;
      report(error);
    } finally {
      loadingFonts.value = false;
    }
  })();
  return loaded;
}
