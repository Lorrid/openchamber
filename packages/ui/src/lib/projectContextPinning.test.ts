import { describe, expect, test } from 'bun:test';

import { countPinnedItems, selectPinnedItems } from './projectContextPinning';
import type { ProjectNote, ProjectPlanLink } from './projectContextApi';

/**
 * Assembling the pinned block and deciding when a session needs it moved to the
 * server (`packages/web/server/lib/session-knowledge`). What is left here is
 * the selection the composer chip counts.
 */

const note = (overrides: Partial<ProjectNote> = {}): ProjectNote => ({
  id: 'n1',
  body: 'A note.',
  createdAt: 1,
  updatedAt: 1,
  source: 'manual',
  pinned: false,
  ...overrides,
});

const plan = (overrides: Partial<ProjectPlanLink> = {}): ProjectPlanLink => ({
  id: 'p1',
  file: 'p1.md',
  title: 'A plan',
  createdAt: 1,
  pinned: false,
  ...overrides,
});

describe('what counts as pinned', () => {
  test('takes only the pinned notes and plans', () => {
    const selection = selectPinnedItems({
      notes: [note({ id: 'a', pinned: true }), note({ id: 'b' })],
      plans: [plan({ id: 'c', pinned: true }), plan({ id: 'd' })],
    });

    expect(selection.notes.map((item) => item.id)).toEqual(['a']);
    expect(selection.plans.map((item) => item.id)).toEqual(['c']);
  });

  test('nothing pinned selects nothing', () => {
    const selection = selectPinnedItems({ notes: [note()], plans: [plan()] });

    expect(countPinnedItems(selection)).toBe(0);
  });

  test('counts notes and plans together', () => {
    const selection = selectPinnedItems({
      notes: [note({ id: 'a', pinned: true }), note({ id: 'b', pinned: true })],
      plans: [plan({ id: 'c', pinned: true })],
    });

    expect(countPinnedItems(selection)).toBe(3);
  });
});
