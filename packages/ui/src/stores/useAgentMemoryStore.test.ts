import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { AgentMemoryDisabledError, type AgentMemoryEntry } from '@/lib/agentMemoryApi';

function entry(overrides: Partial<AgentMemoryEntry> = {}): AgentMemoryEntry {
  return {
    id: 'mem-1',
    title: 'Uses bun',
    body: 'Tests run with bun test.',
    type: 'fact',
    createdAt: 1,
    updatedAt: 1,
    reviewed: false,
    ...overrides,
  };
}

interface MemoryReadResult {
  global: AgentMemoryEntry[];
  project: AgentMemoryEntry[];
  globalFailed: boolean;
  projectFailed: boolean;
}

/**
 * Swappable implementations rather than mock helpers: each test states the one
 * behaviour it needs, and the recorded patch is asserted directly.
 */
let readImpl: () => Promise<MemoryReadResult>;
let updateImpl: (memoryId: string, patch: Record<string, unknown>) => Promise<AgentMemoryEntry>;
let deleteImpl: () => Promise<void>;
let lastUpdatePatch: Record<string, unknown> | null = null;

mock.module('@/lib/agentMemoryApi', () => ({
  AgentMemoryDisabledError,
  fetchAgentMemory: () => readImpl(),
  updateAgentMemory: (
    _scope: string,
    _projectPath: string | null,
    memoryId: string,
    patch: Record<string, unknown>,
  ) => {
    lastUpdatePatch = patch;
    return updateImpl(memoryId, patch);
  },
  deleteAgentMemory: () => deleteImpl(),
}));

const { useAgentMemoryStore, countUnreviewedMemories } = await import('./useAgentMemoryStore');

beforeEach(() => {
  useAgentMemoryStore.getState().reset();
  lastUpdatePatch = null;
  readImpl = async () => ({
    global: [entry({ id: 'g1', title: 'About user' })],
    project: [entry({ id: 'p1', title: 'About project' })],
    globalFailed: false,
    projectFailed: false,
  });
  updateImpl = async (memoryId, patch) => ({ ...entry({ id: memoryId }), ...patch });
  deleteImpl = async () => undefined;
});

afterEach(() => {
  useAgentMemoryStore.getState().reset();
});

describe('load', () => {
  test('holds both scopes', async () => {
    await useAgentMemoryStore.getState().load('/tmp/project');

    const state = useAgentMemoryStore.getState();
    expect(state.global.map((item) => item.id)).toEqual(['g1']);
    expect(state.project.map((item) => item.id)).toEqual(['p1']);
    expect(state.loaded).toBe(true);
  });

  test('a failed load keeps what was already held', async () => {
    await useAgentMemoryStore.getState().load('/tmp/project');
    readImpl = async () => { throw new Error('offline'); };

    await useAgentMemoryStore.getState().load('/tmp/project');

    const state = useAgentMemoryStore.getState();
    // Blanking here would read as the agent having forgotten everything.
    expect(state.global).toHaveLength(1);
    expect(state.error).toBe('offline');
  });

  test('a disabled feature clears the lists rather than reporting an error', async () => {
    await useAgentMemoryStore.getState().load('/tmp/project');
    readImpl = async () => { throw new AgentMemoryDisabledError(); };

    await useAgentMemoryStore.getState().load('/tmp/project');

    const state = useAgentMemoryStore.getState();
    expect(state.disabled).toBe(true);
    expect(state.global).toHaveLength(0);
    expect(state.error).toBeNull();
  });

  test('a partly failed read is recorded as failed, not as empty', async () => {
    readImpl = async () => ({ global: [], project: [], globalFailed: true, projectFailed: false });

    await useAgentMemoryStore.getState().load('/tmp/project');

    expect(useAgentMemoryStore.getState().globalFailed).toBe(true);
  });
});

describe('snapshot for the session index', () => {
  test('is null until a load has succeeded', () => {
    expect(useAgentMemoryStore.getState().snapshot()).toBeNull();
  });

  test('is null while the feature is off', async () => {
    readImpl = async () => { throw new AgentMemoryDisabledError(); };
    await useAgentMemoryStore.getState().load(null);

    expect(useAgentMemoryStore.getState().snapshot()).toBeNull();
  });

  test('carries both scopes once loaded', async () => {
    await useAgentMemoryStore.getState().load('/tmp/project');

    expect(useAgentMemoryStore.getState().snapshot()?.project).toHaveLength(1);
  });
});

describe('review', () => {
  test('marks an entry reviewed', async () => {
    await useAgentMemoryStore.getState().load('/tmp/project');

    const ok = await useAgentMemoryStore.getState().setReviewed('global', 'g1', true);

    expect(ok).toBe(true);
    expect(useAgentMemoryStore.getState().global[0].reviewed).toBe(true);
  });

  test('rolls back when the write fails', async () => {
    await useAgentMemoryStore.getState().load('/tmp/project');
    updateImpl = async () => { throw new Error('write failed'); };

    const ok = await useAgentMemoryStore.getState().setReviewed('global', 'g1', true);

    expect(ok).toBe(false);
    expect(useAgentMemoryStore.getState().global[0].reviewed).toBe(false);
    expect(useAgentMemoryStore.getState().error).toBe('write failed');
  });

  test('touches only the scope it was given', async () => {
    await useAgentMemoryStore.getState().load('/tmp/project');

    await useAgentMemoryStore.getState().setReviewed('global', 'g1', true);

    expect(useAgentMemoryStore.getState().project[0].reviewed).toBe(false);
  });
});

describe('edit', () => {
  test('a user edit keeps the entry reviewed', async () => {
    await useAgentMemoryStore.getState().load('/tmp/project');

    await useAgentMemoryStore.getState().saveEntry('project', 'p1', { body: 'Rewritten by the user.' });

    // The store revokes approval only for a rewrite the agent made; the user
    // editing an entry is them reviewing it.
    expect(lastUpdatePatch).toEqual({ body: 'Rewritten by the user.', reviewed: true });
  });

  test('reports a failed edit', async () => {
    await useAgentMemoryStore.getState().load('/tmp/project');
    updateImpl = async () => { throw new Error('nope'); };

    expect(await useAgentMemoryStore.getState().saveEntry('project', 'p1', { body: 'x' })).toBe(false);
  });
});

describe('delete', () => {
  test('removes the entry', async () => {
    await useAgentMemoryStore.getState().load('/tmp/project');

    const ok = await useAgentMemoryStore.getState().deleteEntry('project', 'p1');

    expect(ok).toBe(true);
    expect(useAgentMemoryStore.getState().project).toHaveLength(0);
  });

  test('restores the entry when the delete fails', async () => {
    await useAgentMemoryStore.getState().load('/tmp/project');
    deleteImpl = async () => { throw new Error('offline'); };

    const ok = await useAgentMemoryStore.getState().deleteEntry('project', 'p1');

    expect(ok).toBe(false);
    expect(useAgentMemoryStore.getState().project).toHaveLength(1);
  });
});

describe('unreviewed count', () => {
  test('counts only what the user has not confirmed', () => {
    expect(countUnreviewedMemories([
      entry({ id: 'a', reviewed: false }),
      entry({ id: 'b', reviewed: true }),
      entry({ id: 'c', reviewed: false }),
    ])).toBe(2);
  });
});
