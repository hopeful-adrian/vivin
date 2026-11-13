import type { ProjectInfo } from './project-api';

const limit = 12;

export function parseRecentProjects(value: unknown): ProjectInfo[] {
  if (!Array.isArray(value)) return [];
  const projects: ProjectInfo[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      !('path' in item) ||
      typeof item.path !== 'string' ||
      !item.path.trim() ||
      projects.some((project) => project.path === item.path)
    )
      continue;
    projects.push({ name: item.name, path: item.path });
    if (projects.length === limit) break;
  }
  return projects;
}

export function rememberRecentProject(
  projects: ProjectInfo[],
  project: ProjectInfo,
): ProjectInfo[] {
  return parseRecentProjects([project, ...projects.filter((item) => item.path !== project.path)]);
}
