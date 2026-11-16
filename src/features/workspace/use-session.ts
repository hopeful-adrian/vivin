import { watch } from 'vue';
import { parseWorkspaceSession, rememberWorkspaceSession } from '../../lib/workspace-session';
import { documentPaths, project } from '../project/use-project';
import { readLocalJson, usePreferences, writeLocalJson } from '../settings/use-preferences';
import { activePane, openDoc, panes, split, toggleSplit } from './use-panes';

const storageKey = 'vivin.sessions';
const { preferences } = usePreferences();
let restoring = false;

function storedSession(projectPath: string) {
  const store = readLocalJson(storageKey);
  return store && typeof store === 'object'
    ? parseWorkspaceSession((store as Record<string, unknown>)[projectPath])
    : null;
}

function saveSession() {
  const current = project.value;
  if (!current || restoring || !preferences.restoreSession) return;
  // Project switches clear the panes before the new project is set; keep the old session.
  if (panes.value.every((pane) => !pane.path)) return;
  writeLocalJson(
    storageKey,
    rememberWorkspaceSession(readLocalJson(storageKey), current.path, {
      panes: panes.value.map((pane) => ({ path: pane.path, mode: pane.mode })),
      active: activePane.value,
      split: Math.round(split.value),
    }),
  );
}

watch(
  () => [
    panes.value.map((pane) => `${pane.mode}:${pane.path ?? ''}`).join('\n'),
    activePane.value,
    split.value,
  ],
  saveSession,
);

/** Reopens the documents and modes last used in the current project, skipping removed files. */
export async function restoreSession() {
  const current = project.value;
  if (!current || !preferences.restoreSession) return;
  const session = storedSession(current.path);
  if (!session) return;
  const available = new Set(documentPaths.value);
  const wanted = session.panes.map((pane) => ({
    mode: pane.mode,
    path: pane.path && available.has(pane.path) ? pane.path : null,
  }));
  if (!wanted.some((pane) => pane.path)) return;
  restoring = true;
  try {
    if (wanted.length === 2 && panes.value.length === 1) toggleSplit();
    split.value = session.split;
    for (const [index, entry] of wanted.entries()) {
      const pane = panes.value[index];
      if (!pane || project.value !== current) return;
      pane.mode = entry.mode;
      if (entry.path) await openDoc(entry.path, index);
    }
    if (project.value === current)
      activePane.value = Math.min(session.active, panes.value.length - 1);
  } finally {
    restoring = false;
  }
}
