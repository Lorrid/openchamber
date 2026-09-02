import { describe, expect, test } from 'bun:test';

import {
  guestSessionTitle,
  guestWorktreeBranch,
  planStartGuestSession,
  runStartGuestSession,
  type StartGuestSessionDeps,
} from './start-session.ts';

const request = {
  providerId: 'gitlab',
  id: '!12',
  title: 'Fix login',
  url: 'https://gitlab.com/acme/app/-/merge_requests/12',
  kind: 'pull' as const,
  author: 'ada',
  branches: { head: 'feature', base: 'main' },
  text: 'MR context',
};

const deps = (overrides: Partial<StartGuestSessionDeps> = {}): StartGuestSessionDeps => ({
  createSession: overrides.createSession ?? (async (title, directory) => ({ id: 'ses-1', directory })),
  createWorktree: overrides.createWorktree ?? (async (_directory, _branch, _kind) => ({ id: 'ses-2', directory: '/wt' })),
  initializeSession: overrides.initializeSession ?? (() => {}),
  setLinkedIssue: overrides.setLinkedIssue ?? (async () => {}),
  sendFirstMessage: overrides.sendFirstMessage ?? (async () => 'sent'),
  closeSurfaces: overrides.closeSurfaces ?? (() => {}),
});

describe('guestSessionTitle', () => {
  test('joins id and title', () => {
    expect(guestSessionTitle(request)).toBe('!12 Fix login');
  });
});

describe('guestWorktreeBranch', () => {
  test('sanitizes the identifier', () => {
    expect(guestWorktreeBranch('!12', 'pull')).toBe('pr-12');
    expect(guestWorktreeBranch('TICKET-1', 'issue')).toBe('issue-ticket-1');
  });
});

describe('planStartGuestSession', () => {
  test('refuses a missing directory', () => {
    expect(planStartGuestSession(request, null, 1)).toEqual({ ok: false, reason: 'no-directory' });
    expect(planStartGuestSession(request, '   ', 1).ok).toBe(false);
  });

  test('builds a linked pull snapshot', () => {
    const plan = planStartGuestSession({ ...request, worktree: true }, '/repo', 42);
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.worktree).toBe(true);
    expect(plan.kind).toBe('pr');
    expect(plan.linked).toEqual({
      id: 'guest:gitlab:!12',
      providerId: 'gitlab',
      identifier: '!12',
      title: 'Fix login',
      url: 'https://gitlab.com/acme/app/-/merge_requests/12',
      kind: 'guest',
      thread: 'pull',
      author: 'ada',
      head: 'feature',
      base: 'main',
      linkedAt: 42,
    });
    expect(plan.text).toBe('MR context');
  });
});

describe('runStartGuestSession', () => {
  test('creates a session and links without sending when text is missing', async () => {
    const linked: string[] = [];
    const plan = planStartGuestSession({ ...request, text: undefined, worktree: false }, '/repo', 1);
    if (!plan.ok) {
      throw new Error('expected a plan');
    }
    const result = await runStartGuestSession(plan, deps({
      setLinkedIssue: async (sessionId) => {
        linked.push(sessionId);
      },
    }));
    expect(result).toEqual({ ok: true, sessionId: 'ses-1', sent: 'skipped' });
    expect(linked).toEqual(['ses-1']);
  });

  test('uses the worktree path and does not leave a session when that create fails', async () => {
    const plan = planStartGuestSession({ ...request, worktree: true }, '/repo', 1);
    if (!plan.ok) {
      throw new Error('expected a plan');
    }
    let linked = 0;
    const result = await runStartGuestSession(plan, deps({
      createWorktree: async () => null,
      setLinkedIssue: async () => {
        linked += 1;
      },
    }));
    expect(result).toEqual({ ok: false, reason: 'worktree-failed' });
    expect(linked).toBe(0);
  });

  test('sends guest text after the session exists', async () => {
    const plan = planStartGuestSession(request, '/repo', 1);
    if (!plan.ok) {
      throw new Error('expected a plan');
    }
    const sent: string[] = [];
    const result = await runStartGuestSession(plan, deps({
      sendFirstMessage: async (_sessionId, _directory, text) => {
        sent.push(text);
        return 'sent';
      },
    }));
    expect(result).toEqual({ ok: true, sessionId: 'ses-1', sent: 'sent' });
    expect(sent).toEqual(['MR context']);
  });
});
