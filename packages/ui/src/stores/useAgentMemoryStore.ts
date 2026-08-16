/**
 * Agent memory, as the panel and the send path see it.
 *
 * The server owns the store; this holds the last snapshot read from it and
 * serializes writes so two quick edits cannot land out of order.
 *
 * A failed load never blanks what is already held. An empty list would read as
 * "the agent has forgotten everything", which is the one wrong answer here: the
 * user would go looking for lost memory that is sitting safely on disk.
 */

import { create } from 'zustand';

import {
  AgentMemoryDisabledError,
  deleteAgentMemory,
  fetchAgentMemory,
  updateAgentMemory,
  type AgentMemoryEntry,
  type AgentMemoryScope,
  type AgentMemorySnapshot,
} from '@/lib/agentMemoryApi';
import { forgetMemoryIndexForSession, resetMemoryIndexTracking } from '@/lib/agentMemoryIndex';

interface AgentMemoryState {
  global: AgentMemoryEntry[];
  project: AgentMemoryEntry[];
  /** The project path the held `project` entries belong to. */
  projectPath: string | null;
  loading: boolean;
  loaded: boolean;
  /** True once the server has reported the feature switched off. */
  disabled: boolean;
  globalFailed: boolean;
  projectFailed: boolean;
  error: string | null;

  load: (projectPath: string | null) => Promise<void>;
  setReviewed: (scope: AgentMemoryScope, memoryId: string, reviewed: boolean) => Promise<boolean>;
  saveEntry: (
    scope: AgentMemoryScope,
    memoryId: string,
    patch: { title?: string; body?: string },
  ) => Promise<boolean>;
  deleteEntry: (scope: AgentMemoryScope, memoryId: string) => Promise<boolean>;
  snapshot: () => AgentMemorySnapshot | null;
  reset: () => void;
}

const EMPTY_STATE = {
  global: [] as AgentMemoryEntry[],
  project: [] as AgentMemoryEntry[],
  projectPath: null as string | null,
  loading: false,
  loaded: false,
  disabled: false,
  globalFailed: false,
  projectFailed: false,
  error: null as string | null,
};

/** Serializes writes so a slow first request cannot overwrite a later one. */
let writeChain: Promise<unknown> = Promise.resolve();
const enqueueWrite = <T>(work: () => Promise<T>): Promise<T> => {
  const next = writeChain.then(work, work);
  writeChain = next.catch(() => undefined);
  return next;
};

const listFor = (state: AgentMemoryState, scope: AgentMemoryScope): AgentMemoryEntry[] => (
  scope === 'global' ? state.global : state.project
);

const withList = (
  scope: AgentMemoryScope,
  entries: AgentMemoryEntry[],
): Partial<AgentMemoryState> => (
  scope === 'global' ? { global: entries } : { project: entries }
);

const errorMessage = (error: unknown, fallback: string): string => (
  error instanceof Error && error.message ? error.message : fallback
);

export const useAgentMemoryStore = create<AgentMemoryState>((set, get) => ({
  ...EMPTY_STATE,

  load: async (projectPath) => {
    set({ loading: true });
    try {
      const snapshot = await fetchAgentMemory(projectPath);
      set({
        global: snapshot.global,
        project: snapshot.project,
        projectPath,
        globalFailed: snapshot.globalFailed,
        projectFailed: snapshot.projectFailed,
        loading: false,
        loaded: true,
        disabled: false,
        error: null,
      });
    } catch (error) {
      if (error instanceof AgentMemoryDisabledError) {
        // Switched off is not a failure. Clearing the lists is right here and
        // only here: with the feature off there is nothing for the user to act
        // on, and the tab that would show them is gone too.
        set({ ...EMPTY_STATE, disabled: true, loaded: true });
        return;
      }
      // Whatever was loaded before stays. Only the error is new.
      set({ loading: false, error: errorMessage(error, 'Failed to load agent memory') });
    }
  },

  setReviewed: async (scope, memoryId, reviewed) => enqueueWrite(async () => {
    const previous = listFor(get(), scope);
    const optimistic = previous.map((entry) => (entry.id === memoryId ? { ...entry, reviewed } : entry));
    set(withList(scope, optimistic));

    try {
      const saved = await updateAgentMemory(scope, get().projectPath, memoryId, { reviewed });
      set(withList(scope, listFor(get(), scope).map((entry) => (entry.id === memoryId ? saved : entry))));
      return true;
    } catch (error) {
      set({ ...withList(scope, previous), error: errorMessage(error, 'Failed to save memory') });
      return false;
    }
  }),

  saveEntry: async (scope, memoryId, patch) => enqueueWrite(async () => {
    const previous = listFor(get(), scope);
    try {
      // The user is the one editing, so their approval survives the rewrite;
      // the store only revokes it for a rewrite the agent made.
      const saved = await updateAgentMemory(scope, get().projectPath, memoryId, { ...patch, reviewed: true });
      set(withList(scope, listFor(get(), scope).map((entry) => (entry.id === memoryId ? saved : entry))));
      return true;
    } catch (error) {
      set({ ...withList(scope, previous), error: errorMessage(error, 'Failed to save memory') });
      return false;
    }
  }),

  deleteEntry: async (scope, memoryId) => enqueueWrite(async () => {
    const previous = listFor(get(), scope);
    set(withList(scope, previous.filter((entry) => entry.id !== memoryId)));

    try {
      await deleteAgentMemory(scope, get().projectPath, memoryId);
      return true;
    } catch (error) {
      set({ ...withList(scope, previous), error: errorMessage(error, 'Failed to delete memory') });
      return false;
    }
  }),

  /**
   * What the send path indexes. Null until a load has actually succeeded, so a
   * session is never told the agent remembers nothing merely because the panel
   * has not been opened yet.
   */
  snapshot: () => {
    const state = get();
    if (!state.loaded || state.disabled) {
      return null;
    }
    return {
      global: state.global,
      project: state.project,
      globalFailed: state.globalFailed,
      projectFailed: state.projectFailed,
    };
  },

  reset: () => {
    resetMemoryIndexTracking();
    set({ ...EMPTY_STATE });
  },
}));

export const forgetAgentMemoryForSession = (sessionId: string): void => {
  forgetMemoryIndexForSession(sessionId);
};

export const countUnreviewedMemories = (entries: AgentMemoryEntry[]): number => (
  entries.reduce((total, entry) => (entry.reviewed ? total : total + 1), 0)
);
