export type SessionMode = 'source' | 'rendered';

export interface WorkspaceSession {
  panes: { path: string | null; mode: SessionMode }[];
  active: number;
  split: number;
}

/** Projects whose open documents are remembered; older entries are dropped first. */
export const sessionLimit = 12;

function parsePane(value: unknown): WorkspaceSession['panes'][number] | null {
  if (!value || typeof value !== 'object') return null;
  const { path, mode } = value as Record<string, unknown>;
  if (path !== null && (typeof path !== 'string' || !path)) return null;
  return { path, mode: mode === 'source' ? 'source' : 'rendered' };
}

/** Validates one stored session; paths are still checked against the project tree on restore. */
export function parseWorkspaceSession(value: unknown): WorkspaceSession | null {
  if (!value || typeof value !== 'object') return null;
  const { panes, active, split } = value as Record<string, unknown>;
  if (!Array.isArray(panes)) return null;
  const parsed = panes.slice(0, 2).map(parsePane);
  if (!parsed.length || parsed.some((pane) => pane === null)) return null;
  const valid = parsed.filter((pane) => pane !== null);
  return {
    panes: valid,
    active: Number.isInteger(active)
      ? Math.max(0, Math.min(valid.length - 1, active as number))
      : 0,
    split:
      typeof split === 'number' && Number.isFinite(split) ? Math.max(25, Math.min(75, split)) : 50,
  };
}

/** Stores the session as the most recent project and keeps at most `sessionLimit` projects. */
export function rememberWorkspaceSession(
  store: unknown,
  projectPath: string,
  session: WorkspaceSession,
): Record<string, WorkspaceSession> {
  const next: Record<string, WorkspaceSession> = { [projectPath]: session };
  if (!store || typeof store !== 'object' || Array.isArray(store)) return next;
  for (const [path, value] of Object.entries(store)) {
    if (Object.keys(next).length >= sessionLimit) break;
    const parsed = path === projectPath ? null : parseWorkspaceSession(value);
    if (parsed) next[path] = parsed;
  }
  return next;
}
