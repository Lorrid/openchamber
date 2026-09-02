import { describe, expect, test } from 'bun:test';

import {
  actorLabel,
  buildLinearFilters,
  detailFromHostJson,
  detailFromJson,
  getLinearIssue,
  liftLinearUploadLinks,
  linearIssueGetPath,
  linearListBody,
  mapLinearComment,
  mapLinearIssue,
  priorityLabel,
  rowsFromListJson,
} from './linear.ts';

describe('mapLinearIssue', () => {
  test('maps a GraphQL node onto the kit task', () => {
    const row = mapLinearIssue({
      id: 'iss-1',
      identifier: 'ENG-12',
      title: 'Login submits twice',
      url: 'https://linear.app/acme/issue/ENG-12',
      priority: 1,
      description: 'Double click on Sign in.',
      state: { name: 'In Progress' },
      assignee: { name: 'ada', displayName: 'Ada' },
      team: { key: 'ENG', name: 'Engineering' },
    });
    expect(row?.item).toEqual({
      id: 'iss-1',
      title: 'Login submits twice',
      identifier: 'ENG-12',
      url: 'https://linear.app/acme/issue/ENG-12',
      status: 'In Progress',
      priority: 'Urgent',
      assignee: 'Ada',
      team: 'ENG',
    });
    expect(row?.description).toBe('Double click on Sign in.');
  });

  test('drops a row without an id or title', () => {
    expect(mapLinearIssue({
      id: '',
      identifier: 'ENG-0',
      title: 'Nope',
      url: '',
      priority: 0,
      description: '',
    })).toBeNull();
  });
});

describe('liftLinearUploadLinks', () => {
  test('turns a Linear upload link into image markdown', () => {
    expect(liftLinearUploadLinks('See [shot.png](https://uploads.linear.app/a/b)')).toBe(
      'See ![shot.png](https://uploads.linear.app/a/b)',
    );
  });

  test('leaves an already marked image and a normal link alone', () => {
    expect(liftLinearUploadLinks('![shot](https://uploads.linear.app/a.png)')).toBe(
      '![shot](https://uploads.linear.app/a.png)',
    );
    expect(liftLinearUploadLinks('[docs](https://linear.app/docs)')).toBe(
      '[docs](https://linear.app/docs)',
    );
  });
});

describe('mapLinearComment', () => {
  test('keeps a comment with a body', () => {
    expect(mapLinearComment({
      id: 'c1',
      body: 'Looks good',
      createdAt: '2026-01-01T00:00:00.000Z',
      user: { name: 'ada', displayName: 'Ada' },
    })).toEqual({
      id: 'c1',
      body: 'Looks good',
      author: 'Ada',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('rowsFromListJson', () => {
  test('reads GraphQL nodes', () => {
    const rows = rowsFromListJson(JSON.stringify({
      data: {
        issues: {
          nodes: [{
            id: 'iss-1',
            identifier: 'ENG-12',
            title: 'Login',
            url: 'https://linear.app/acme/issue/ENG-12',
            priority: 2,
            state: { name: 'Todo' },
          }],
        },
      },
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.item.identifier).toBe('ENG-12');
    expect(rows[0]?.item.priority).toBe('High');
  });

  test('keeps siblings when Linear sends a null assignee', () => {
    const rows = rowsFromListJson(JSON.stringify({
      data: {
        issues: {
          nodes: [
            {
              id: 'iss-1',
              identifier: 'ENG-12',
              title: 'Unassigned',
              url: 'https://linear.app/acme/issue/ENG-12',
              priority: 4,
              state: { name: 'Backlog' },
              assignee: null,
            },
            {
              id: 'iss-2',
              identifier: 'ENG-13',
              title: 'Assigned',
              url: 'https://linear.app/acme/issue/ENG-13',
              priority: 2,
              state: { name: 'Todo' },
              assignee: { name: 'ada', displayName: 'Ada' },
            },
          ],
        },
      },
    }));
    expect(rows.map((row) => row.item.identifier)).toEqual(['ENG-12', 'ENG-13']);
    expect(rows[0]?.item.assignee).toBeUndefined();
    expect(rows[1]?.item.assignee).toBe('Ada');
  });

  test('returns empty on junk', () => {
    expect(rowsFromListJson('{"data":{}}')).toEqual([]);
  });
});

describe('detailFromJson', () => {
  test('keeps the description when a comment has a picture', () => {
    const detail = detailFromJson(JSON.stringify({
      data: {
        issue: {
          id: 'iss-1',
          identifier: 'ENG-12',
          title: 'Login',
          url: 'https://linear.app/acme/issue/ENG-12',
          priority: 2,
          description: 'Double click on Sign in.',
          state: { name: 'Todo' },
          comments: {
            nodes: [{
              id: 'c1',
              body: 'See ![shot](https://uploads.linear.app/a.png)',
              createdAt: '2026-01-01T00:00:00.000Z',
              user: { name: 'ada', displayName: 'Ada' },
            }],
          },
        },
      },
    }));
    expect(detail?.row.description).toBe('Double click on Sign in.');
    expect(detail?.comments[0]?.body).toContain('https://uploads.linear.app/a.png');
  });
});

describe('detailFromHostJson', () => {
  test('reads the first-party Linear get payload', () => {
    const detail = detailFromHostJson(JSON.stringify({
      connected: true,
      issue: {
        id: 'iss-1',
        identifier: 'ENG-12',
        title: 'Login',
        url: 'https://linear.app/acme/issue/ENG-12',
        priority: 2,
        description: 'Double click on Sign in.',
        state: { name: 'Todo' },
        comments: [{
          id: 'c1',
          body: 'See [shot.png](https://uploads.linear.app/a/b)',
          createdAt: '2026-01-01T00:00:00.000Z',
          user: { name: 'ada', displayName: 'Ada' },
        }],
      },
    }));
    expect(detail?.row.description).toBe('Double click on Sign in.');
    expect(detail?.comments[0]?.body).toBe('See ![shot.png](https://uploads.linear.app/a/b)');
  });
});

describe('linear bodies', () => {
  test('lists on GraphQL and gets on the first-party Linear route', () => {
    expect(JSON.parse(linearListBody(25))).toMatchObject({
      variables: { first: 25 },
    });
    expect(linearIssueGetPath()).toBe('/api/linear/issues/get');
  });

  test('loads detail through the host Linear get path', async () => {
    const seen: { path: string; id?: string }[] = [];
    const detail = await getLinearIssue({
      request: async (request) => {
        seen.push({ path: request.path, id: request.query?.id });
        return {
          status: 200,
          body: JSON.stringify({
            connected: true,
            issue: {
              id: 'iss-1',
              identifier: 'ENG-12',
              title: 'Login',
              url: 'https://linear.app/acme/issue/ENG-12',
              priority: 2,
              description: 'Done.',
              state: { name: 'Todo' },
              comments: [],
            },
          }),
        };
      },
    }, 'iss-1');
    expect(seen).toEqual([{ path: '/api/linear/issues/get', id: 'iss-1' }]);
    expect(detail?.row.item.identifier).toBe('ENG-12');
  });
});

describe('buildLinearFilters', () => {
  test('starts on all and includes Linear slots', () => {
    const filters = buildLinearFilters([
      { id: 'a', title: 'A', status: 'Todo', priority: 'Urgent', assignee: 'Ada', team: 'ENG' },
      { id: 'b', title: 'B', status: 'Todo', priority: 'Low', assignee: 'Bev', team: 'DES' },
    ]);
    expect(filters.map((filter) => filter.id)).toEqual(['status', 'priority', 'assignee', 'team']);
    expect(filters.every((filter) => filter.value === 'all')).toBe(true);
    expect(filters[0]?.slot).toBe('start');
    expect(filters[0]?.options[0]).toEqual({ id: 'all', label: 'All' });
  });

  test('restores a remembered value when that option still exists', () => {
    const filters = buildLinearFilters(
      [{ id: 'a', title: 'A', status: 'Todo', priority: 'Urgent', assignee: 'Ada', team: 'ENG' }],
      { status: 'Todo', assignee: 'gone' },
    );
    expect(filters.find((filter) => filter.id === 'status')?.value).toBe('Todo');
    expect(filters.find((filter) => filter.id === 'assignee')?.value).toBe('all');
  });
});

describe('labels', () => {
  test('prefers displayName', () => {
    expect(actorLabel({ name: 'ada', displayName: 'Ada Lovelace' })).toBe('Ada Lovelace');
    expect(priorityLabel(4)).toBe('Low');
    expect(priorityLabel(0)).toBe('');
  });
});
