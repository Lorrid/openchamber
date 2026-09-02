import { describe, expect, test } from 'bun:test';

import {
  buildClickupFilters,
  clickupListPath,
  clickupListTasksPath,
  clickupStatusBody,
  clickupTaskCommentsPath,
  clickupTaskPath,
  detailFromBodies,
  hasMoreClickupPages,
  mapClickupComment,
  mapClickupTask,
  priorityLabel,
  rowsFromListJson,
  statusesFromListJson,
} from './clickup.ts';

describe('mapClickupTask', () => {
  test('maps a list row onto the kit task', () => {
    const row = mapClickupTask({
      id: 'abc',
      name: 'Login submits twice',
      custom_id: 'CU-12',
      url: 'https://app.clickup.com/t/abc',
      status: 'in progress',
      assignees: [{ id: '9', username: 'Ada' }],
      priority: '1',
      tags: [{ name: 'bug' }],
      text_content: 'Double click on Sign in.',
    });
    expect(row?.item).toEqual({
      id: 'abc',
      title: 'Login submits twice',
      identifier: 'CU-12',
      url: 'https://app.clickup.com/t/abc',
      status: 'in progress',
      priority: '1',
      assignee: 'Ada',
    });
    expect(row?.description).toBe('Double click on Sign in.');
    expect(row?.tags).toEqual([{ id: 'bug', name: 'bug' }]);
  });

  test('drops a row without an id or title', () => {
    expect(mapClickupTask({
      id: '',
      name: 'Nope',
      custom_id: '',
      url: '',
      status: '',
      assignees: [],
      priority: null,
      tags: [],
      text_content: '',
    })).toBeNull();
  });
});

describe('mapClickupComment', () => {
  test('keeps author and a calendar day', () => {
    expect(mapClickupComment({
      id: 'c1',
      comment_text: 'Reproduced.',
      date: Date.UTC(2026, 2, 3),
      user: { username: 'Ada' },
    })).toEqual({
      id: 'c1',
      author: 'Ada',
      body: 'Reproduced.',
      createdAt: '2026-03-03',
    });
  });
});

describe('rowsFromListJson', () => {
  test('reads a ClickUp list body', () => {
    const rows = rowsFromListJson(JSON.stringify({
      tasks: [{
        id: 12,
        name: 'Ship',
        custom_id: null,
        status: { status: 'open', color: '#fff' },
        assignees: [{ id: 9, username: 'Ada' }],
        priority: { id: '2', priority: 'high' },
        tags: [{ name: 'api' }],
        text_content: 'Body',
      }],
    }));
    expect(rows[0]?.item).toEqual({
      id: '12',
      title: 'Ship',
      identifier: '12',
      url: 'https://app.clickup.com/t/12',
      status: 'open',
      priority: '2',
      assignee: 'Ada',
    });
    expect(rows[0]?.description).toBe('Body');
  });
});

describe('detailFromBodies', () => {
  test('drops a body that is not a task', () => {
    expect(detailFromBodies('{"tasks":[]}', '{"comments":[]}')).toBeNull();
  });

  test('keeps comments from a string date', () => {
    const detail = detailFromBodies(
      JSON.stringify({ id: 'abc', name: 'Login submits twice' }),
      JSON.stringify({
        comments: [{
          id: 'c1',
          comment_text: 'Reproduced.',
          date: String(Date.UTC(2026, 2, 3)),
          user: { username: 'Ada' },
        }],
      }),
    );
    expect(detail?.comments).toEqual([{
      id: 'c1',
      author: 'Ada',
      body: 'Reproduced.',
      createdAt: '2026-03-03',
    }]);
  });
});

describe('statusesFromListJson', () => {
  test('keeps the list pipeline order', () => {
    expect(statusesFromListJson(JSON.stringify({
      statuses: [
        { status: 'complete', orderindex: 2 },
        { status: 'to do', orderindex: 0 },
        { status: 'in progress', orderindex: 1 },
      ],
    }))).toEqual(['to do', 'in progress', 'complete']);
  });
});

describe('buildClickupFilters', () => {
  test('uses unique status values and Linear slots', () => {
    const filters = buildClickupFilters([
      { id: 'a', title: 'A', status: 'open', priority: '1', assignee: '9' },
      { id: 'b', title: 'B', status: 'open', priority: '4', assignee: '8' },
    ]);
    expect(filters[0]?.slot).toBe('start');
    expect(filters[0]?.options.map((option) => option.id)).toEqual(['all', 'open']);
    expect(priorityLabel('1')).toBe('Urgent');
    expect(filters[1]?.options.some((option) => option.label === 'Urgent')).toBe(true);
  });

  test('puts the list pipeline before statuses found on rows', () => {
    const filters = buildClickupFilters(
      [{ id: 'a', title: 'A', status: 'in progress' }],
      ['to do', 'in progress', 'complete'],
    );
    expect(filters[0]?.options.map((option) => option.id)).toEqual([
      'all',
      'to do',
      'in progress',
      'complete',
    ]);
  });
});

describe('clickupStatusBody', () => {
  test('writes the ClickUp status field', () => {
    expect(clickupStatusBody('in progress')).toBe('{"status":"in progress"}');
    expect(clickupStatusBody('   ')).toBeNull();
  });
});

describe('hasMoreClickupPages', () => {
  test('stops on a short page', () => {
    expect(hasMoreClickupPages(99)).toBe(false);
    expect(hasMoreClickupPages(100)).toBe(true);
  });
});

describe('clickup paths', () => {
  test('stay on /api/v2 and never include a token', () => {
    expect(clickupListPath('9015')).toBe('/api/v2/list/9015');
    expect(clickupListTasksPath('9015')).toBe('/api/v2/list/9015/task');
    expect(clickupTaskPath('abc')).toBe('/api/v2/task/abc');
    expect(clickupTaskCommentsPath('abc')).toBe('/api/v2/task/abc/comment');
  });
});
