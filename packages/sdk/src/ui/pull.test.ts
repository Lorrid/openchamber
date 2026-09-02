import { describe, expect, test } from 'bun:test';

import {
  clampPullCreate,
  failedPullChecks,
  pullRequestStatusText,
  resolvePullRequestLabels,
} from './pull.ts';

describe('resolvePullRequestLabels', () => {
  test('fills host-style defaults and keeps a guest override', () => {
    expect(resolvePullRequestLabels({}).overview).toBe('Overview');
    expect(resolvePullRequestLabels({ attach: 'Pin' }).attach).toBe('Pin');
  });
});

describe('pullRequestStatusText', () => {
  test('joins state and mergeability', () => {
    const copy = resolvePullRequestLabels({});
    expect(pullRequestStatusText({
      id: '!12',
      title: 'Fix login',
      state: 'open',
      mergeable: false,
    }, copy)).toBe('open · Not mergeable');
    expect(pullRequestStatusText({
      id: '!12',
      title: 'Fix login',
      state: 'draft',
    }, copy)).toBe('draft');
  });
});

describe('clampPullCreate', () => {
  test('needs title, head, and base', () => {
    expect(clampPullCreate({
      title: '  ',
      description: 'Body',
      head: 'feature',
      base: 'main',
      draft: false,
    })).toBeNull();
    expect(clampPullCreate({
      title: 'Fix login',
      description: '  notes  ',
      head: 'feature',
      base: 'main',
      draft: true,
    })).toEqual({
      title: 'Fix login',
      description: 'notes',
      head: 'feature',
      base: 'main',
      draft: true,
    });
  });
});

describe('failedPullChecks', () => {
  test('keeps only failures', () => {
    expect(failedPullChecks([
      { id: '1', name: 'lint', state: 'success' },
      { id: '2', name: 'test', state: 'failure', detail: 'boom' },
      { id: '3', name: 'build', state: 'pending' },
    ])).toEqual([{ id: '2', name: 'test', state: 'failure', detail: 'boom' }]);
  });
});
