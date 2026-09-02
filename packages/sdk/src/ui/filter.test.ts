import { describe, expect, test } from 'bun:test';

import { filterIssueTasks } from './filter.ts';
import { resolveFilterSlot } from './filters.ts';
import type { IssueFilter, IssueTask } from './types.ts';

const items: IssueTask[] = [
  { id: 'a', identifier: 'ENG-1', title: 'Login is broken', status: 'todo', priority: 'high', assignee: 'ada' },
  { id: 'b', identifier: 'ENG-2', title: 'Ship the picker', status: 'started', priority: 'low', assignee: 'ada' },
  { id: 'c', identifier: 'DES-1', title: 'Empty state', status: 'todo', priority: 'low', assignee: 'bev' },
];

const status: IssueFilter = {
  id: 'status',
  label: 'Status',
  field: 'status',
  value: 'all',
  options: [
    { id: 'all', label: 'All' },
    { id: 'todo', label: 'Todo' },
    { id: 'started', label: 'Started' },
  ],
};

describe('filterIssueTasks', () => {
  test('returns every item when query and filters are idle', () => {
    expect(filterIssueTasks(items, '', [status])).toEqual(items);
  });

  test('matches identifier or title', () => {
    expect(filterIssueTasks(items, 'des-1', [status]).map((item) => item.id)).toEqual(['c']);
    expect(filterIssueTasks(items, 'picker', [status]).map((item) => item.id)).toEqual(['b']);
  });

  test('matches badge and subtitle', () => {
    const withMeta: IssueTask[] = [
      { id: 'a', title: 'Login', badge: 'acme/app', subtitle: 'feature → main' },
      { id: 'b', title: 'Other', badge: 'acme/docs' },
    ];
    expect(filterIssueTasks(withMeta, 'acme/app').map((item) => item.id)).toEqual(['a']);
    expect(filterIssueTasks(withMeta, 'feature').map((item) => item.id)).toEqual(['a']);
  });

  test('applies an active filter and ignores the all value', () => {
    expect(filterIssueTasks(items, '', [{ ...status, value: 'todo' }]).map((item) => item.id)).toEqual(['a', 'c']);
    expect(filterIssueTasks(items, 'login', [{ ...status, value: 'started' }])).toEqual([]);
  });

  test('treats a missing value as all', () => {
    expect(filterIssueTasks(items, '', [{ ...status, value: '' }])).toEqual(items);
  });
});

describe('resolveFilterSlot', () => {
  test('uses the first filter as start and the rest as end', () => {
    expect(resolveFilterSlot(status, 0)).toBe('start');
    expect(resolveFilterSlot({ ...status, id: 'priority' }, 1)).toBe('end');
  });

  test('honors an explicit slot', () => {
    expect(resolveFilterSlot({ ...status, slot: 'end' }, 0)).toBe('end');
    expect(resolveFilterSlot({ ...status, slot: 'start' }, 2)).toBe('start');
  });
});
