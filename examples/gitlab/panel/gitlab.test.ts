import { describe, expect, test } from 'bun:test';

import {
  buildGitlabFilters,
  detailFromBodies,
  gitlabCreateMergeRequestBody,
  gitlabIssueNotesPath,
  gitlabIssuePath,
  gitlabIssuesPath,
  gitlabMergeBody,
  gitlabMergeRequestChangesPath,
  gitlabMergeRequestMergePath,
  gitlabMergeRequestNotesPath,
  gitlabMergeRequestPath,
  gitlabMergeRequestPipelinesPath,
  gitlabMergeRequestRebasePath,
  gitlabMergeRequestsPath,
  gitlabPullState,
  gitlabStateBody,
  hasMoreGitlabPages,
  mapGitlabIssue,
  mapGitlabMergeRequest,
  mapGitlabNote,
  mapGitlabPipeline,
  mapGitlabPull,
  pullDetailFromBodies,
  rowsFromIssuesJson,
  rowsFromMergeRequestsJson,
  textFromMergeRequestChanges,
} from './gitlab.ts';

describe('mapGitlabIssue', () => {
  test('maps a list row onto the kit task', () => {
    const row = mapGitlabIssue({
      id: '99',
      iid: '12',
      title: 'Login submits twice',
      web_url: 'https://gitlab.com/acme/app/-/issues/12',
      state: 'opened',
      description: 'Double click on Sign in.',
      labels: ['bug'],
      assignees: [{ username: 'ada' }],
    });
    expect(row?.item).toEqual({
      id: '12',
      title: 'Login submits twice',
      identifier: '#12',
      url: 'https://gitlab.com/acme/app/-/issues/12',
      status: 'opened',
      assignee: 'ada',
      team: 'Issue',
    });
    expect(row?.description).toBe('Double click on Sign in.');
    expect(row?.tags).toEqual([{ id: 'bug', name: 'bug' }]);
    expect(row?.thread).toBe('issue');
  });

  test('drops a row without an iid or title', () => {
    expect(mapGitlabIssue({
      id: '1',
      iid: '',
      title: 'Nope',
      web_url: '',
      state: '',
      description: '',
      labels: [],
      assignees: [],
    })).toBeNull();
  });
});

describe('mapGitlabNote', () => {
  test('keeps a human note and a calendar day', () => {
    expect(mapGitlabNote({
      id: 'c1',
      body: 'Reproduced.',
      created_at: '2026-03-03T12:00:00.000Z',
      system: false,
      author: { username: 'ada' },
    })).toEqual({
      id: 'c1',
      author: 'ada',
      body: 'Reproduced.',
      createdAt: '2026-03-03',
    });
  });

  test('drops a system note', () => {
    expect(mapGitlabNote({
      id: 'c2',
      body: 'changed the status',
      created_at: '2026-03-03T12:00:00.000Z',
      system: true,
      author: { username: 'ada' },
    })).toBeNull();
  });
});

describe('mapGitlabMergeRequest', () => {
  test('maps a merge request onto a pull row', () => {
    const row = mapGitlabMergeRequest({
      id: '88',
      iid: '12',
      title: 'Fix login',
      web_url: 'https://gitlab.com/acme/app/-/merge_requests/12',
      state: 'opened',
      description: 'Use one click.',
      labels: ['bug'],
      assignees: [{ username: 'bev' }],
      author: { username: 'ada' },
      source_branch: 'feature',
      target_branch: 'main',
    }, 'acme/app');
    expect(row?.item).toEqual({
      id: '!12',
      title: 'Fix login',
      identifier: '!12',
      url: 'https://gitlab.com/acme/app/-/merge_requests/12',
      status: 'opened',
      assignee: 'bev',
      team: 'Merge request',
      badge: 'acme/app',
      subtitle: 'feature → main',
    });
    expect(row?.thread).toBe('pull');
    expect(row?.author).toBe('ada');
    expect(row?.branches).toEqual({ head: 'feature', base: 'main' });
  });
});

describe('rowsFromIssuesJson', () => {
  test('reads a GitLab issues array', () => {
    const rows = rowsFromIssuesJson(JSON.stringify([{
      id: 99,
      iid: 12,
      title: 'Ship',
      web_url: 'https://gitlab.com/acme/app/-/issues/12',
      state: 'opened',
      description: 'Body',
      labels: ['api'],
      assignees: [{ username: 'ada' }],
    }]));
    expect(rows[0]?.item).toEqual({
      id: '12',
      title: 'Ship',
      identifier: '#12',
      url: 'https://gitlab.com/acme/app/-/issues/12',
      status: 'opened',
      assignee: 'ada',
      team: 'Issue',
    });
    expect(rows[0]?.description).toBe('Body');
  });
});

describe('rowsFromMergeRequestsJson', () => {
  test('reads a GitLab merge request array', () => {
    const rows = rowsFromMergeRequestsJson(JSON.stringify([{
      id: 88,
      iid: 12,
      title: 'Fix login',
      web_url: 'https://gitlab.com/acme/app/-/merge_requests/12',
      source_branch: 'feature',
      target_branch: 'main',
    }]), 'acme/app');
    expect(rows[0]?.item.id).toBe('!12');
    expect(rows[0]?.item.subtitle).toBe('feature → main');
    expect(rows[0]?.thread).toBe('pull');
  });
});

describe('textFromMergeRequestChanges', () => {
  test('keeps file diffs and drops junk', () => {
    expect(textFromMergeRequestChanges(JSON.stringify({
      changes: [
        { new_path: 'src/a.ts', old_path: 'src/a.ts', diff: '+ok' },
        { new_path: 'src/b.ts', old_path: 'src/b.ts', diff: '' },
      ],
    }))).toBe('src/a.ts\n+ok');
    expect(textFromMergeRequestChanges('nope')).toBe('');
  });
});

describe('detailFromBodies', () => {
  test('drops a body that is not an issue', () => {
    expect(detailFromBodies('[]', '[]')).toBeNull();
  });

  test('keeps notes and skips system ones', () => {
    const detail = detailFromBodies(
      JSON.stringify({ id: 99, iid: 12, title: 'Login submits twice' }),
      JSON.stringify([
        {
          id: 'c1',
          body: 'Reproduced.',
          created_at: '2026-03-03T12:00:00.000Z',
          author: { username: 'ada' },
        },
        {
          id: 'c2',
          body: 'changed the status',
          system: true,
          author: { username: 'ada' },
        },
      ]),
    );
    expect(detail?.comments).toEqual([{
      id: 'c1',
      author: 'ada',
      body: 'Reproduced.',
      createdAt: '2026-03-03',
    }]);
  });
});

describe('buildGitlabFilters', () => {
  test('puts opened and closed first', () => {
    const filters = buildGitlabFilters([
      { id: '1', title: 'A', status: 'opened', assignee: 'ada' },
      { id: '2', title: 'B', status: 'closed', assignee: 'bev' },
    ]);
    expect(filters[0]?.slot).toBe('start');
    expect(filters[0]?.options.map((option) => option.id)).toEqual(['all', 'opened', 'closed']);
    expect(filters[1]?.options.map((option) => option.id)).toEqual(['all', 'ada', 'bev']);
  });
});

describe('gitlabStateBody', () => {
  test('writes GitLab state_event', () => {
    expect(gitlabStateBody('opened')).toBe('{"state_event":"reopen"}');
    expect(gitlabStateBody('closed')).toBe('{"state_event":"close"}');
    expect(gitlabStateBody('   ')).toBeNull();
  });
});

describe('hasMoreGitlabPages', () => {
  test('stops on a short page', () => {
    expect(hasMoreGitlabPages(99)).toBe(false);
    expect(hasMoreGitlabPages(100)).toBe(true);
  });
});

describe('gitlab paths', () => {
  test('encode the project path and stay on /api/v4', () => {
    expect(gitlabIssuesPath('acme/app')).toBe('/api/v4/projects/acme%2Fapp/issues');
    expect(gitlabIssuePath('acme/app', '12')).toBe('/api/v4/projects/acme%2Fapp/issues/12');
    expect(gitlabIssueNotesPath('acme/app', '12')).toBe('/api/v4/projects/acme%2Fapp/issues/12/notes');
    expect(gitlabMergeRequestsPath('acme/app')).toBe('/api/v4/projects/acme%2Fapp/merge_requests');
    expect(gitlabMergeRequestPath('acme/app', '!12')).toBe('/api/v4/projects/acme%2Fapp/merge_requests/12');
    expect(gitlabMergeRequestChangesPath('acme/app', '!12')).toBe('/api/v4/projects/acme%2Fapp/merge_requests/12/changes');
    expect(gitlabMergeRequestNotesPath('acme/app', '!12')).toBe('/api/v4/projects/acme%2Fapp/merge_requests/12/notes');
    expect(gitlabMergeRequestPipelinesPath('acme/app', '!12')).toBe('/api/v4/projects/acme%2Fapp/merge_requests/12/pipelines');
    expect(gitlabMergeRequestMergePath('acme/app', '!12')).toBe('/api/v4/projects/acme%2Fapp/merge_requests/12/merge');
    expect(gitlabMergeRequestRebasePath('acme/app', '!12')).toBe('/api/v4/projects/acme%2Fapp/merge_requests/12/rebase');
  });
});

describe('mapGitlabPull', () => {
  test('maps draft and mergeability onto the kit record', () => {
    expect(gitlabPullState({
      id: '1',
      iid: '12',
      title: 'Fix login',
      web_url: '',
      state: 'opened',
      description: '',
      labels: [],
      assignees: [],
      source_branch: 'feature',
      target_branch: 'main',
      draft: true,
      merge_status: '',
      detailed_merge_status: '',
    })).toBe('draft');
    const pull = mapGitlabPull({
      id: '1',
      iid: '12',
      title: 'Fix login',
      web_url: 'https://gitlab.com/acme/app/-/merge_requests/12',
      state: 'opened',
      description: 'Body',
      labels: [],
      assignees: [],
      author: { username: 'ada' },
      source_branch: 'feature',
      target_branch: 'main',
      draft: false,
      merge_status: 'can_be_merged',
      detailed_merge_status: 'mergeable',
    });
    expect(pull).toMatchObject({
      id: '!12',
      title: 'Fix login',
      state: 'open',
      head: 'feature',
      base: 'main',
      author: 'ada',
      mergeable: true,
    });
  });
});

describe('mapGitlabPipeline', () => {
  test('maps GitLab pipeline status onto a check row', () => {
    expect(mapGitlabPipeline({
      id: '9',
      status: 'failed',
      name: 'test',
      web_url: 'https://gitlab.com/acme/app/-/pipelines/9',
    })).toEqual({
      id: '9',
      name: 'test',
      state: 'failure',
      detail: 'https://gitlab.com/acme/app/-/pipelines/9',
    });
  });
});

describe('pullDetailFromBodies', () => {
  test('keeps notes and pipelines', () => {
    const detail = pullDetailFromBodies(
      JSON.stringify({
        id: 88,
        iid: 12,
        title: 'Fix login',
        description: 'Body',
        source_branch: 'feature',
        target_branch: 'main',
      }),
      JSON.stringify([{ id: 'c1', body: 'Looks good', author: { username: 'bev' } }]),
      JSON.stringify([{ id: 9, status: 'success', name: 'test' }]),
    );
    expect(detail?.pull.id).toBe('!12');
    expect(detail?.comments[0]?.author).toBe('bev');
    expect(detail?.checks[0]?.state).toBe('success');
  });
});

describe('gitlab write bodies', () => {
  test('create and merge stay JSON', () => {
    expect(JSON.parse(gitlabCreateMergeRequestBody({
      title: 'Fix login',
      description: 'Body',
      head: 'feature',
      base: 'main',
      draft: true,
    }))).toEqual({
      title: 'Fix login',
      description: 'Body',
      source_branch: 'feature',
      target_branch: 'main',
      draft: true,
    });
    expect(gitlabMergeBody('squash')).toBe('{"squash":true}');
    expect(gitlabMergeBody('merge')).toBe('{"squash":false}');
  });
});
