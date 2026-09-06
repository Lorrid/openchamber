import { describe, expect, it } from 'vitest';

import { buildWorkspaceProjectUpdate, buildWorkspaceProjectWithdrawal } from './workspace-project.js';

const EXISTING = { id: 'path_home', path: 'C:\\Users\\ekmen', addedAt: 1, lastOpenedAt: 1 };

describe('buildWorkspaceProjectUpdate', () => {
  it('registers a missing workspace as a new project and makes it active', () => {
    const update = buildWorkspaceProjectUpdate({
      projects: [EXISTING],
      workspaceHostPath: 'C:\\proj\\demo',
      now: 42,
    });
    expect(update.added).toBe(true);
    expect(update.projects).toHaveLength(2);
    expect(update.projects[0]).toBe(EXISTING);
    expect(update.projects[1]).toMatchObject({ path: 'C:\\proj\\demo', addedAt: 42, lastOpenedAt: 42 });
    expect(update.activeProjectId).toBe(update.projects[1].id);
    expect(update.activeProjectId).toMatch(/^path_/);
  });

  it('reuses an existing project entry (by id or path) and only refreshes lastOpenedAt', () => {
    const workspace = { id: 'path_ws', path: 'C:\\proj\\demo', addedAt: 1, lastOpenedAt: 1 };
    const byId = buildWorkspaceProjectUpdate({ projects: [EXISTING, workspace], workspaceHostPath: 'C:\\proj\\demo' });
    expect(byId.added).toBe(false);
    expect(byId.projects).toHaveLength(2);
    expect(byId.activeProjectId).toBe('path_ws');
    expect(byId.projects[1].addedAt).toBe(1);

    const byPath = buildWorkspaceProjectUpdate({ projects: [EXISTING, workspace], workspaceHostPath: 'C:\\proj\\demo' });
    expect(byPath.activeProjectId).toBe('path_ws');
  });

  it('keeps the input array untouched (pure)', () => {
    const projects = [EXISTING];
    buildWorkspaceProjectUpdate({ projects, workspaceHostPath: 'C:\\proj\\demo' });
    expect(projects).toHaveLength(1);
  });

  it('requires a workspace path', () => {
    expect(() => buildWorkspaceProjectUpdate({ projects: [], workspaceHostPath: '  ' })).toThrow(/required/);
  });
});

describe('buildWorkspaceProjectWithdrawal', () => {
  it('withdraws the workspace project by id or path match and keeps siblings', () => {
    const workspace = { id: 'path_ws', path: 'C:\\proj\\demo', addedAt: 1 };
    const result = buildWorkspaceProjectWithdrawal({
      projects: [EXISTING, workspace],
      workspaceHostPath: 'C:\\proj\\demo',
    });
    expect(result.matched).toBe(true);
    expect(result.projects).toEqual([EXISTING]);
  });

  it('reports unmatched when the project was already gone (idempotent)', () => {
    const result = buildWorkspaceProjectWithdrawal({ projects: [EXISTING], workspaceHostPath: 'C:\\gone\\x' });
    expect(result.matched).toBe(false);
    expect(result.projects).toEqual([EXISTING]);
  });

  it('requires a workspace path', () => {
    expect(() => buildWorkspaceProjectWithdrawal({ projects: [], workspaceHostPath: '' })).toThrow(/required/);
  });
});
