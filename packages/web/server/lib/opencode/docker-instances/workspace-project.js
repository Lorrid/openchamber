/**
 * Projects-settings bridge for Docker-backed instances.
 *
 * When a Docker instance becomes the active upstream its workspace must act
 * as the default project, otherwise the session sidebar (which groups by
 * project) shows nothing until the user manually re-adds the folder. This
 * builds the settings update: register the workspace as a project when
 * missing and make it the active project. Deactivation restores whatever was
 * active before the first activation.
 */

import { createProjectIdFromPath } from '../../projects/project-id.js';

const asPath = (value) => String(value ?? '').trim();

/**
 * @param {object} params
 * @param {Array<{id: string, path: string, addedAt?: number, lastOpenedAt?: number, [key: string]: unknown}>} params.projects - current persisted projects (unchanged on failure).
 * @param {string} params.workspaceHostPath - the active instance's workspace.
 * @param {number} [params.now]
 * @returns {{ projects: Array<object>, activeProjectId: string, added: boolean }}
 */
export const buildWorkspaceProjectUpdate = ({ projects, workspaceHostPath, now = Date.now() }) => {
  const workspacePath = asPath(workspaceHostPath);
  if (!workspacePath) {
    throw new Error('workspaceHostPath is required');
  }
  const projectId = createProjectIdFromPath(workspacePath);
  const current = Array.isArray(projects) ? projects : [];
  const existing = current.find((project) => project?.id === projectId || asPath(project?.path) === workspacePath);

  if (existing) {
    return {
      projects: current.map((project) => (
        project?.id === existing.id
          ? { ...project, lastOpenedAt: now }
          : project
      )),
      activeProjectId: existing.id,
      added: false,
    };
  }

  return {
    projects: [
      ...current,
      { id: projectId, path: workspacePath, addedAt: now, lastOpenedAt: now },
    ],
    activeProjectId: projectId,
    added: true,
  };
};

/**
 * Builds the settings update that withdraws the workspace project entry on
 * deactivation. Callers decide WHEN this is safe (the approved rule: only
 * when the Local upstream has no sessions under that directory — otherwise
 * the folder holds real local work and must stay).
 *
 * `activeProjectId` handling: callers pass the previously active project id;
 * when it points at the withdrawn workspace itself they must omit it and let
 * the settings runtime fall back to the first remaining project.
 *
 * @param {object} params
 * @param {Array<object>} params.projects - current persisted projects.
 * @param {string} params.workspaceHostPath - the deactivated instance's workspace.
 * @returns {{ projects: Array<object>, withdrawnId: string, matched: boolean }}
 */
export const buildWorkspaceProjectWithdrawal = ({ projects, workspaceHostPath }) => {
  const workspacePath = asPath(workspaceHostPath);
  if (!workspacePath) {
    throw new Error('workspaceHostPath is required');
  }
  const projectId = createProjectIdFromPath(workspacePath);
  const current = Array.isArray(projects) ? projects : [];
  const matched = current.some((project) => project?.id === projectId || asPath(project?.path) === workspacePath);
  return {
    projects: current.filter((project) => project?.id !== projectId && asPath(project?.path) !== workspacePath),
    withdrawnId: projectId,
    matched,
  };
};
