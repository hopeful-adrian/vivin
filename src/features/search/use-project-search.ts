import { nextTick, ref, watch } from 'vue';
import { searchDocuments, type SearchHit } from '../../lib/project-api';
import { onProjectReset } from '../project/use-project';
import { report } from '../ui/use-toast';
import { panel } from '../workspace/use-layout';

export const query = ref('');
export const hits = ref<SearchHit[]>([]);
export const searchedQuery = ref('');
export const searching = ref(false);
export const searchRan = ref(false);
let searchRequest = 0;

watch(query, () => {
  hits.value = [];
  searchRan.value = false;
});

onProjectReset(() => {
  query.value = '';
  hits.value = [];
  searchRan.value = false;
  searchRequest++;
  searching.value = false;
});

export async function runSearch() {
  const term = query.value;
  if (!term.trim()) {
    hits.value = [];
    searchRan.value = false;
    return;
  }
  searching.value = true;
  panel.value = 'search';
  hits.value = [];
  const request = ++searchRequest;
  try {
    const found = await searchDocuments(term);
    if (request === searchRequest && term === query.value) {
      hits.value = found;
      searchedQuery.value = term.trim();
      searchRan.value = true;
    }
  } catch (error) {
    report(error);
  } finally {
    if (request === searchRequest) searching.value = false;
  }
}

export async function openProjectSearch(text?: string) {
  panel.value = 'search';
  if (text !== undefined) {
    query.value = text;
    if (text.trim()) await runSearch();
  }
  await nextTick();
  document.getElementById('vivin-project-search')?.focus();
}
