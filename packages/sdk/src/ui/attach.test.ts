import { describe, expect, test } from 'bun:test';

import { applyFilterValues, hasIssueAction, hasIssueMore, hasIssueToggle } from './chrome.ts';
import { filterIssueTasks } from './filter.ts';
import { issueRowParts } from './list.ts';
import type { IssueFilter, IssueTask } from './types.ts';

const items: IssueTask[] = [
  { id: 'a', identifier: 'ENG-1', title: 'Login is broken', status: 'todo', assignee: 'ada' },
  { id: 'b', identifier: 'ENG-2', title: 'Ship the picker', status: 'started', assignee: 'bev' },
];

const status: IssueFilter = {
  id: 'status',
  label: 'Status',
  field: 'status',
  value: 'all',
  options: [
    { id: 'all', label: 'All' },
    { id: 'todo', label: 'Todo' },
  ],
};

describe('applyFilterValues', () => {
  test('keeps a chosen value when the guest refreshes definitions', () => {
    const live = applyFilterValues([status], { status: 'todo' });
    expect(live[0]?.value).toBe('todo');
    expect(filterIssueTasks(items, '', live).map((item) => item.id)).toEqual(['a']);
  });

  test('uses the definition value when that id has not been chosen yet', () => {
    expect(applyFilterValues([{ ...status, value: 'todo' }], {})[0]?.value).toBe('todo');
  });

  test('keeps slot when the guest refreshes definitions', () => {
    expect(applyFilterValues([{ ...status, slot: 'end' }], { status: 'todo' })[0]?.slot).toBe('end');
  });
});

describe('issue picker chrome extras', () => {
  test('row parts expose badge and subtitle without inventing them', () => {
    expect(issueRowParts({
      id: '!12',
      title: 'Fix login',
      identifier: '!12',
      badge: 'acme/app',
      subtitle: 'feature → main',
    })).toEqual({
      id: '!12',
      title: 'Fix login',
      badge: 'acme/app',
      subtitle: 'feature → main',
    });
    expect(issueRowParts({ id: '12', title: 'Login' })).toEqual({
      id: '12',
      title: 'Login',
      badge: '',
      subtitle: '',
    });
  });

  test('load more needs both a flag and a handler', () => {
    expect(hasIssueMore({ hasMore: true, onMore: () => undefined })).toBe(true);
    expect(hasIssueMore({ hasMore: true })).toBe(false);
    expect(hasIssueMore({ onMore: () => undefined })).toBe(false);
  });

  test('toggle is present only when the guest passed one', () => {
    expect(hasIssueToggle({ label: 'Include diff', checked: false, onChange: () => undefined })).toBe(true);
    expect(hasIssueToggle(undefined)).toBe(false);
  });

  test('page action is present only when the guest passed one', () => {
    expect(hasIssueAction({ label: 'New merge request', onClick: () => undefined })).toBe(true);
    expect(hasIssueAction(undefined)).toBe(false);
  });
});
