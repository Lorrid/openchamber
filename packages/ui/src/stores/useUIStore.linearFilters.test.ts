import { beforeEach, describe, expect, test } from 'bun:test';
import { LINEAR_ISSUE_LIST_ALL_TEAMS, useUIStore } from './useUIStore';

describe('linear issue list filters', () => {
  beforeEach(() => {
    useUIStore.setState({
      linearIssueListStatus: 'open',
      linearIssueListAssignee: 'any',
      linearIssueListTeamId: LINEAR_ISSUE_LIST_ALL_TEAMS,
      linearIssueListPriority: 'all',
    });
  });

  test('stores status, assignee, team, and priority across setter calls', () => {
    useUIStore.getState().setLinearIssueListStatus('completed');
    useUIStore.getState().setLinearIssueListAssignee('me');
    useUIStore.getState().setLinearIssueListTeamId('team-eng');
    useUIStore.getState().setLinearIssueListPriority('urgent');

    expect(useUIStore.getState().linearIssueListStatus).toBe('completed');
    expect(useUIStore.getState().linearIssueListAssignee).toBe('me');
    expect(useUIStore.getState().linearIssueListTeamId).toBe('team-eng');
    expect(useUIStore.getState().linearIssueListPriority).toBe('urgent');
  });

  test('treats a blank team id as all teams', () => {
    useUIStore.getState().setLinearIssueListTeamId('team-eng');
    useUIStore.getState().setLinearIssueListTeamId('   ');
    expect(useUIStore.getState().linearIssueListTeamId).toBe(LINEAR_ISSUE_LIST_ALL_TEAMS);
  });
});
