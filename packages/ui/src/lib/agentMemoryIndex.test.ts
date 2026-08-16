import { beforeEach, describe, expect, test } from 'bun:test';

import {
  buildMemoryIndexSignature,
  buildMemoryIndexText,
  forgetMemoryIndexForSession,
  markMemoryIndexSent,
  resetMemoryIndexTracking,
  resolveMemoryIndexPart,
  shouldSendMemoryIndex,
} from './agentMemoryIndex';
import type { AgentMemoryEntry } from './agentMemoryApi';

const entry = (overrides: Partial<AgentMemoryEntry> = {}): AgentMemoryEntry => ({
  id: 'mem-1',
  title: 'Uses bun',
  body: 'Long body that must never reach the index.',
  type: 'fact',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const snapshot = (overrides: Partial<{
  global: AgentMemoryEntry[];
  project: AgentMemoryEntry[];
  globalFailed: boolean;
  projectFailed: boolean;
}> = {}) => ({
  global: [] as AgentMemoryEntry[],
  project: [] as AgentMemoryEntry[],
  globalFailed: false,
  projectFailed: false,
  ...overrides,
});

beforeEach(() => {
  resetMemoryIndexTracking();
});

describe('index text', () => {
  test('lists titles and never bodies', () => {
    const text = buildMemoryIndexText({ global: [entry()], project: [] });

    expect(text).toContain('Uses bun');
    expect(text).not.toContain('Long body');
  });

  test('labels each scope for what it is', () => {
    const text = buildMemoryIndexText({
      global: [entry({ id: 'g', title: 'About user' })],
      project: [entry({ id: 'p', title: 'About project' })],
    });

    expect(text.indexOf('### About the user')).toBeLessThan(text.indexOf('### About this project'));
  });

  test('omits a scope that has nothing', () => {
    const text = buildMemoryIndexText({ global: [], project: [entry()] });

    expect(text).not.toContain('### About the user');
  });

  test('warns that memory can be stale', () => {
    expect(buildMemoryIndexText({ global: [entry()], project: [] }))
      .toContain('Verify anything it says');
  });

  test('an empty store produces no block at all', () => {
    expect(buildMemoryIndexText({ global: [], project: [] })).toBe('');
  });
});

describe('signature', () => {
  test('an edited memory changes the signature so the index goes again', () => {
    const before = buildMemoryIndexSignature({ global: [entry()], project: [] });
    const after = buildMemoryIndexSignature({ global: [entry({ updatedAt: 2 })], project: [] });

    expect(after).not.toBe(before);
  });

  test('the same set in a different order is the same signature', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b' });

    expect(buildMemoryIndexSignature({ global: [a, b], project: [] }))
      .toBe(buildMemoryIndexSignature({ global: [b, a], project: [] }));
  });

  test('the same id in the two scopes is not one entry', () => {
    expect(buildMemoryIndexSignature({ global: [entry()], project: [] }))
      .not.toBe(buildMemoryIndexSignature({ global: [], project: [entry()] }));
  });
});

describe('send tracking', () => {
  test('sends once, then not again for the same set', () => {
    expect(shouldSendMemoryIndex('ses_1', 'sig')).toBe(true);
    markMemoryIndexSent('ses_1', 'sig');
    expect(shouldSendMemoryIndex('ses_1', 'sig')).toBe(false);
  });

  test('a changed set sends again', () => {
    markMemoryIndexSent('ses_1', 'sig');
    expect(shouldSendMemoryIndex('ses_1', 'sig2')).toBe(true);
  });

  test('tracking is per session', () => {
    markMemoryIndexSent('ses_1', 'sig');
    expect(shouldSendMemoryIndex('ses_2', 'sig')).toBe(true);
  });

  test('a deleted session forgets what it was sent', () => {
    markMemoryIndexSent('ses_1', 'sig');
    forgetMemoryIndexForSession('ses_1');
    expect(shouldSendMemoryIndex('ses_1', 'sig')).toBe(true);
  });
});

describe('resolving a part for a send', () => {
  test('returns the block the first time', () => {
    const part = resolveMemoryIndexPart({
      sessionId: 'ses_1',
      snapshot: snapshot({ global: [entry()] }),
    });

    expect(part?.text).toContain('Uses bun');
  });

  test('returns nothing once the session already has it', () => {
    const options = { sessionId: 'ses_1', snapshot: snapshot({ global: [entry()] }) };
    const first = resolveMemoryIndexPart(options);
    markMemoryIndexSent(first!.sessionId, first!.signature);

    expect(resolveMemoryIndexPart(options)).toBeNull();
  });

  test('sends nothing when memory has not loaded yet', () => {
    expect(resolveMemoryIndexPart({ sessionId: 'ses_1', snapshot: null })).toBeNull();
  });

  test('sends nothing rather than half the memory when a scope failed', () => {
    // Indexing one scope as if it were everything would teach the agent to
    // store again what it already knows.
    const part = resolveMemoryIndexPart({
      sessionId: 'ses_1',
      snapshot: snapshot({ global: [entry()], projectFailed: true }),
    });

    expect(part).toBeNull();
  });

  test('sends nothing without a session', () => {
    expect(resolveMemoryIndexPart({ sessionId: '', snapshot: snapshot({ global: [entry()] }) }))
      .toBeNull();
  });

  test('an empty store sends nothing', () => {
    expect(resolveMemoryIndexPart({ sessionId: 'ses_1', snapshot: snapshot() })).toBeNull();
  });
});
