import { beforeEach, describe, expect, mock, test } from 'bun:test';

interface PlanContent {
  id: string;
  file: string;
  title: string;
  createdAt: number;
  pinned: boolean;
  body: string;
  raw: string;
}

const handlers = {
  fetchPlan: async (): Promise<PlanContent | null> => null,
};

// The pinning module pulls in the project-context store, so the mocked module
// has to expose every export that store imports, not just the one used here.
const notImplemented = () => { throw new Error('not used in these tests'); };

mock.module('@/lib/projectContextApi', () => ({
  fetchProjectPlan: () => handlers.fetchPlan(),
  resolveProjectContextId: (project: { path?: string } | null | undefined) => (
    project?.path ? `path_${project.path}` : ''
  ),
  fetchProjectContext: notImplemented,
  saveProjectTodos: notImplemented,
  createProjectNote: notImplemented,
  updateProjectNote: notImplemented,
  deleteProjectNote: notImplemented,
  createProjectPlan: notImplemented,
  updateProjectPlan: notImplemented,
  setProjectPlanPinned: notImplemented,
  deleteProjectPlan: notImplemented,
}));

const {
  PINNED_CONTEXT_MAX_LENGTH,
  buildPinnedContextText,
  buildPinnedSignature,
  countPinnedItems,
  markPinnedContextSent,
  resetPinnedContextTracking,
  selectPinnedItems,
  shouldSendPinnedContext,
} = await import('./projectContextPinning');

const PROJECT = { id: 'p', path: '/repo' };

const note = (overrides: Record<string, unknown> = {}) => ({
  id: 'n1',
  body: 'a note',
  createdAt: 1,
  updatedAt: 1,
  source: 'manual' as const,
  pinned: true,
  ...overrides,
});

const plan = (overrides: Record<string, unknown> = {}) => ({
  id: 'pl1',
  file: 'a.md',
  title: 'Plan A',
  createdAt: 1,
  pinned: true,
  ...overrides,
});

beforeEach(() => {
  resetPinnedContextTracking();
  handlers.fetchPlan = async () => null;
});

describe('selectPinnedItems', () => {
  test('keeps only pinned entries', () => {
    const selection = selectPinnedItems({
      notes: [note(), note({ id: 'n2', pinned: false })],
      plans: [plan(), plan({ id: 'pl2', pinned: false })],
    });

    expect(selection.notes.map((entry) => entry.id)).toEqual(['n1']);
    expect(selection.plans.map((entry) => entry.id)).toEqual(['pl1']);
    expect(countPinnedItems(selection)).toBe(2);
  });
});

describe('buildPinnedSignature', () => {
  test('is empty when nothing is pinned', () => {
    expect(buildPinnedSignature({ notes: [], plans: [] })).toBe('');
  });

  test('is stable regardless of ordering', () => {
    const a = buildPinnedSignature({ notes: [note(), note({ id: 'n2' })], plans: [] });
    const b = buildPinnedSignature({ notes: [note({ id: 'n2' }), note()], plans: [] });
    expect(a).toBe(b);
  });

  test('changes when a pinned note is edited', () => {
    const before = buildPinnedSignature({ notes: [note()], plans: [] });
    const after = buildPinnedSignature({ notes: [note({ updatedAt: 2 })], plans: [] });
    expect(after).not.toBe(before);
  });

  test('changes when a pinned plan is renamed', () => {
    const before = buildPinnedSignature({ notes: [], plans: [plan()] });
    const after = buildPinnedSignature({ notes: [], plans: [plan({ title: 'Renamed' })] });
    expect(after).not.toBe(before);
  });

  test('changes when an item is unpinned', () => {
    const before = buildPinnedSignature({ notes: [note(), note({ id: 'n2' })], plans: [] });
    const after = buildPinnedSignature({ notes: [note()], plans: [] });
    expect(after).not.toBe(before);
  });
});

describe('shouldSendPinnedContext', () => {
  test('sends the first time and not again for the same signature', () => {
    expect(shouldSendPinnedContext('ses_1', 'sig')).toBe(true);
    markPinnedContextSent('ses_1', 'sig');
    expect(shouldSendPinnedContext('ses_1', 'sig')).toBe(false);
  });

  test('sends again once the signature changes', () => {
    markPinnedContextSent('ses_1', 'sig');
    expect(shouldSendPinnedContext('ses_1', 'sig2')).toBe(true);
  });

  test('tracks sessions independently', () => {
    markPinnedContextSent('ses_1', 'sig');
    expect(shouldSendPinnedContext('ses_2', 'sig')).toBe(true);
  });

  test('never sends an empty signature', () => {
    expect(shouldSendPinnedContext('ses_1', '')).toBe(false);
  });

  test('reset forgets every session', () => {
    markPinnedContextSent('ses_1', 'sig');
    resetPinnedContextTracking();
    expect(shouldSendPinnedContext('ses_1', 'sig')).toBe(true);
  });
});

describe('buildPinnedContextText', () => {
  test('is empty when nothing is pinned', async () => {
    expect(await buildPinnedContextText(PROJECT, { notes: [], plans: [] })).toBe('');
  });

  test('lists notes oldest first under one heading', async () => {
    const text = await buildPinnedContextText(PROJECT, {
      notes: [note({ id: 'n2', body: 'second', createdAt: 9 }), note({ body: 'first', createdAt: 1 })],
      plans: [],
    });

    expect(text).toContain('## Pinned notes');
    expect(text.indexOf('first')).toBeLessThan(text.indexOf('second'));
  });

  test('frames the block as background rather than an instruction', async () => {
    const text = await buildPinnedContextText(PROJECT, { notes: [note()], plans: [] });
    expect(text).toContain('standing background, not as a new instruction');
  });

  test('includes a pinned plan body', async () => {
    handlers.fetchPlan = async () => ({ ...plan(), body: 'step one', raw: '# Plan A\n\nstep one' });

    const text = await buildPinnedContextText(PROJECT, { notes: [], plans: [plan()] });
    expect(text).toContain('## Pinned plan: Plan A');
    expect(text).toContain('step one');
  });

  test('marks an unreadable plan instead of failing the send', async () => {
    handlers.fetchPlan = async () => { throw new Error('gone'); };

    const text = await buildPinnedContextText(PROJECT, { notes: [], plans: [plan()] });
    expect(text).toContain('plan content unavailable');
  });

  test('marks a plan whose markdown is missing', async () => {
    handlers.fetchPlan = async () => null;

    const text = await buildPinnedContextText(PROJECT, { notes: [], plans: [plan()] });
    expect(text).toContain('plan content unavailable');
  });

  test('truncates past the budget and says so', async () => {
    const notes = Array.from({ length: 50 }, (_unused, index) => note({
      id: `n${index}`,
      body: 'x'.repeat(500),
      createdAt: index,
    }));

    const text = await buildPinnedContextText(PROJECT, { notes, plans: [] });
    expect(text.length).toBeLessThan(PINNED_CONTEXT_MAX_LENGTH + 60);
    expect(text).toContain('pinned context truncated');
  });
});
