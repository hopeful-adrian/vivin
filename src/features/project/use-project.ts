import { computed, ref, shallowRef, watch } from 'vue';
import {
  getProjectData,
  listProjectTree,
  listResources,
  type ProjectData,
  type ProjectInfo,
  type ResourceNode,
  type TreeNode,
} from '../../lib/project-api';
import { parseRecentProjects, rememberRecentProject } from '../../lib/recent-projects';
import { readLocalJson, writeLocalJson } from '../settings/use-preferences';

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

const emptyData = (): ProjectData => ({
  schemaVersion: 1,
  pinned: [],
  locked: [],
  terms: [],
  termExceptions: [],
  annotations: [],
});

export const project = ref<ProjectInfo | null>(null);
export const tree = ref<TreeNode[]>([]);
export const resources = ref<ResourceNode[]>([]);
export const data = shallowRef<ProjectData>(emptyData());
export const busy = ref(false);
export const refreshing = ref(false);
export const expanded = ref(new Set<string>());
export const expandedResources = ref(new Set<string>());
export const resourceRootExpanded = ref(true);
export const recentProjects = ref(parseRecentProjects(readLocalJson('vivin.recent-projects')));
watch(recentProjects, (value) => writeLocalJson('vivin.recent-projects', value));

/** Directories already shown once; only new ones are expanded automatically. */
const seenDirectories = new Set<string>();
const resetHandlers: (() => void)[] = [];
let refreshRequests = 0;
let refreshGeneration = 0;

/** Registers state that belongs to one project and must be cleared when it changes. */
export function onProjectReset(handler: () => void) {
  resetHandlers.push(handler);
}

export function lockSource(path: string): string | null {
  let candidate = path;
  while (candidate) {
    if (data.value.locked.includes(candidate)) return candidate;
    const slash = candidate.lastIndexOf('/');
    candidate = slash < 0 ? '' : candidate.slice(0, slash);
  }
  return null;
}

export const rows = computed<TreeRow[]>(() => {
  const result: TreeRow[] = [];
  const visit = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      result.push({ node, depth });
      if (node.kind === 'directory' && expanded.value.has(node.path))
        visit(node.children, depth + 1);
    }
  };
  visit(tree.value, 0);
  return result;
});

export const documentPaths = computed(() => {
  const paths: string[] = [];
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes)
      if (node.kind === 'document') paths.push(node.path);
      else visit(node.children);
  };
  visit(tree.value);
  return paths;
});

export const directoryPaths = computed(() => {
  const paths: string[] = [];
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes)
      if (node.kind === 'directory') {
        paths.push(node.path);
        visit(node.children);
      }
  };
  visit(tree.value);
  return paths;
});

export const resourceRows = computed(() => {
  const result: { node: ResourceNode; depth: number }[] = [];
  const visit = (nodes: ResourceNode[], depth: number) => {
    for (const node of nodes) {
      result.push({ node, depth });
      if (node.kind === 'directory' && expandedResources.value.has(node.path))
        visit(node.children, depth + 1);
    }
  };
  visit(resources.value, 0);
  return result;
});

export const resourceCount = computed(() => {
  const countFiles = (nodes: ResourceNode[]): number =>
    nodes.reduce(
      (total, node) => total + (node.kind === 'file' ? 1 : countFiles(node.children)),
      0,
    );
  return countFiles(resources.value);
});

function expandNew(nodes: TreeNode[]) {
  for (const node of nodes)
    if (node.kind === 'directory') {
      if (!seenDirectories.has(node.path)) {
        seenDirectories.add(node.path);
        expanded.value.add(node.path);
      }
      expandNew(node.children);
    }
}

export function toggleDirectory(path: string) {
  if (expanded.value.has(path)) expanded.value.delete(path);
  else expanded.value.add(path);
}

export async function refresh() {
  const request = ++refreshGeneration;
  const current = project.value;
  refreshRequests++;
  refreshing.value = true;
  try {
    const [nextTree, nextResources, nextData] = await Promise.all([
      listProjectTree(),
      listResources(),
      getProjectData(),
    ]);
    if (request === refreshGeneration && project.value === current) {
      tree.value = nextTree;
      resources.value = nextResources;
      data.value = nextData;
      expandNew(nextTree);
    }
  } finally {
    refreshRequests--;
    refreshing.value = refreshRequests > 0;
  }
}

function resetProjectState() {
  refreshGeneration++;
  tree.value = [];
  resources.value = [];
  data.value = emptyData();
  expanded.value.clear();
  expandedResources.value.clear();
  seenDirectories.clear();
  resourceRootExpanded.value = true;
  for (const handler of resetHandlers) handler();
}

export function activateProject(next: ProjectInfo) {
  resetProjectState();
  project.value = next;
  writeLocalJson('vivin.last-project', next.path);
  recentProjects.value = rememberRecentProject(recentProjects.value, next);
}

export function closeProject() {
  writeLocalJson('vivin.last-project', '');
  project.value = null;
  resetProjectState();
}

export function forgetRecentProject(path: string) {
  recentProjects.value = recentProjects.value.filter((item) => item.path !== path);
}

export function annotationCount(kind: string): number {
  return data.value.annotations.filter((annotation) => annotation.kind === kind).length;
}
