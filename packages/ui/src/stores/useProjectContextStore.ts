/**
 * Project context store: notes, todos, and plan links, keyed by project.
 *
 * Replaces the `openchamber:project-notes-updated` / `openchamber:project-plan-saved`
 * window events that previously forced every mounted panel to re-read the whole
 * config. Writers now mutate the store and every reader re-renders from it.
 *
 * Storage is server-owned; this store is a cache with optimistic mutations.
 * See `packages/web/server/lib/project-context/DOCUMENTATION.md`.
 */

import { create } from 'zustand';

import {
  createProjectPlan,
  deleteProjectPlan,
  fetchProjectContext,
  resolveProjectContextId,
  saveProjectNotesAndTodos,
  updateProjectPlan,
  type ProjectPlanLink,
  type ProjectRef,
  type ProjectTodoItem,
} from '@/lib/projectContextApi';

interface ProjectContextEntry {
  notes: string;
  todos: ProjectTodoItem[];
  plans: ProjectPlanLink[];
  /** True once an authoritative load has succeeded at least once. */
  loaded: boolean;
  loading: boolean;
  /** Last load or save failure. Never clears cached data on its own. */
  error: string | null;
}

interface MutationFlags {
  /** A notes/todos write is in flight; a slower load must not overwrite it. */
  notesTodos: boolean;
  /** A plan create/delete is in flight; same rule. */
  plans: boolean;
}

interface ProjectContextState {
  entries: Record<string, ProjectContextEntry>;
}

interface ProjectContextActions {
  getEntry: (project: ProjectRef | null | undefined) => ProjectContextEntry;
  load: (project: ProjectRef, options?: { force?: boolean }) => Promise<void>;
  saveNotesAndTodos: (project: ProjectRef, value: { notes: string; todos: ProjectTodoItem[] }) => Promise<boolean>;
  appendNotes: (project: ProjectRef, addition: string) => Promise<boolean>;
  createPlan: (project: ProjectRef, value: { title: string; body: string }) => Promise<ProjectPlanLink | null>;
  savePlan: (project: ProjectRef, planId: string, raw: string) => Promise<boolean>;
  deletePlan: (project: ProjectRef, planId: string) => Promise<boolean>;
  reset: () => void;
}

type ProjectContextStore = ProjectContextState & ProjectContextActions;

export const EMPTY_PROJECT_CONTEXT_ENTRY: ProjectContextEntry = {
  notes: '',
  todos: [],
  plans: [],
  loaded: false,
  loading: false,
  error: null,
};

/**
 * Per-project write chains and in-flight mutation flags.
 *
 * Kept outside the store because they are coordination state, not rendered
 * state: putting them in the store would re-render every consumer whenever a
 * write starts or finishes.
 */
const writeChains = new Map<string, Promise<unknown>>();
const mutationFlags = new Map<string, MutationFlags>();

const flagsFor = (projectId: string): MutationFlags => {
  const existing = mutationFlags.get(projectId);
  if (existing) return existing;
  const created: MutationFlags = { notesTodos: false, plans: false };
  mutationFlags.set(projectId, created);
  return created;
};

/**
 * Serialize writes per project so two saves cannot interleave into a
 * last-writer-wins race against the server's own read-modify-write.
 */
const enqueueWrite = <T>(projectId: string, operation: () => Promise<T>): Promise<T> => {
  const previous = writeChains.get(projectId) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  writeChains.set(projectId, next.catch(() => undefined));
  return next;
};

const errorMessage = (error: unknown, fallback: string): string => (
  error instanceof Error && error.message ? error.message : fallback
);

export const useProjectContextStore = create<ProjectContextStore>((set, get) => {
  const patchEntry = (projectId: string, patch: Partial<ProjectContextEntry>) => {
    set((state) => ({
      entries: {
        ...state.entries,
        [projectId]: { ...(state.entries[projectId] ?? EMPTY_PROJECT_CONTEXT_ENTRY), ...patch },
      },
    }));
  };

  const currentEntry = (projectId: string): ProjectContextEntry => (
    get().entries[projectId] ?? EMPTY_PROJECT_CONTEXT_ENTRY
  );

  return {
    entries: {},

    getEntry: (project) => {
      const projectId = resolveProjectContextId(project);
      if (!projectId) return EMPTY_PROJECT_CONTEXT_ENTRY;
      return get().entries[projectId] ?? EMPTY_PROJECT_CONTEXT_ENTRY;
    },

    /**
     * Load authoritative context.
     *
     * A failure sets `error` and leaves any previously loaded data in place:
     * an unreachable server must not read as "this project has no notes",
     * which is exactly how a user loses trust in a notes panel.
     */
    load: async (project, options = {}) => {
      const projectId = resolveProjectContextId(project);
      if (!projectId) return;

      const entry = currentEntry(projectId);
      if (entry.loading) return;
      if (entry.loaded && !options.force) return;

      patchEntry(projectId, { loading: true });

      try {
        const data = await fetchProjectContext(project);
        const flags = flagsFor(projectId);
        const committed = currentEntry(projectId);

        // A mutation that started after this load began is newer than the
        // snapshot; keep the local value for that field group only.
        patchEntry(projectId, {
          notes: flags.notesTodos ? committed.notes : data.notes,
          todos: flags.notesTodos ? committed.todos : data.todos,
          plans: flags.plans ? committed.plans : data.plans,
          loaded: true,
          loading: false,
          error: null,
        });
      } catch (error) {
        patchEntry(projectId, {
          loading: false,
          error: errorMessage(error, 'Failed to load project context'),
        });
      }
    },

    /**
     * Optimistically apply notes/todos, then persist.
     *
     * On failure the previous value is restored, so the panel never shows a
     * value that is not on disk without also showing the error.
     */
    saveNotesAndTodos: async (project, value) => {
      const projectId = resolveProjectContextId(project);
      if (!projectId) return false;

      const previous = currentEntry(projectId);
      patchEntry(projectId, { notes: value.notes, todos: value.todos, error: null });

      const flags = flagsFor(projectId);
      flags.notesTodos = true;

      try {
        const committed = await enqueueWrite(projectId, () => saveProjectNotesAndTodos(project, value));
        patchEntry(projectId, { notes: committed.notes, todos: committed.todos, loaded: true });
        return true;
      } catch (error) {
        patchEntry(projectId, {
          notes: previous.notes,
          todos: previous.todos,
          error: errorMessage(error, 'Failed to save project notes'),
        });
        return false;
      } finally {
        flags.notesTodos = false;
      }
    },

    /**
     * Append a line to notes without clobbering a concurrent editor.
     *
     * Reads the freshest authoritative value first: the caller may be a chat
     * action running while the panel is not even mounted, so the in-memory
     * copy can be stale or absent.
     *
     * Joins with a single newline, matching how distilled chat insights have
     * always been stacked in the notes field.
     */
    appendNotes: async (project, addition) => {
      const projectId = resolveProjectContextId(project);
      const trimmed = addition.trim();
      if (!projectId || !trimmed) return false;

      const entry = currentEntry(projectId);
      if (!entry.loaded) {
        await get().load(project);
        if (currentEntry(projectId).error) return false;
      }

      const existing = currentEntry(projectId).notes;
      const combined = existing.trim() ? `${existing.trimEnd()}\n${trimmed}` : trimmed;
      return get().saveNotesAndTodos(project, {
        notes: combined,
        todos: currentEntry(projectId).todos,
      });
    },

    /**
     * Create a plan. Not optimistic: the id and file name are assigned by the
     * server, and a placeholder row that cannot be opened is worse than a
     * short wait.
     */
    createPlan: async (project, value) => {
      const projectId = resolveProjectContextId(project);
      if (!projectId) return null;

      const flags = flagsFor(projectId);
      flags.plans = true;

      try {
        const { plan, context } = await enqueueWrite(projectId, () => createProjectPlan(project, value));
        patchEntry(projectId, { plans: context.plans, loaded: true, error: null });
        return plan;
      } catch (error) {
        patchEntry(projectId, { error: errorMessage(error, 'Failed to create plan') });
        return null;
      } finally {
        flags.plans = false;
      }
    },

    /**
     * Persist an edited plan and fold the refreshed title back into the list,
     * so renaming a plan's heading in the editor is reflected in the panel
     * without a reload. Resolves false when the plan is gone.
     */
    savePlan: async (project, planId, raw) => {
      const projectId = resolveProjectContextId(project);
      if (!projectId) return false;

      const flags = flagsFor(projectId);
      flags.plans = true;

      try {
        const result = await enqueueWrite(projectId, () => updateProjectPlan(project, planId, raw));
        if (!result) {
          patchEntry(projectId, {
            plans: currentEntry(projectId).plans.filter((plan) => plan.id !== planId),
          });
          return false;
        }
        patchEntry(projectId, {
          plans: currentEntry(projectId).plans.map((plan) => (plan.id === planId ? result.plan : plan)),
          error: null,
        });
        return true;
      } catch (error) {
        patchEntry(projectId, { error: errorMessage(error, 'Failed to save plan') });
        return false;
      } finally {
        flags.plans = false;
      }
    },

    deletePlan: async (project, planId) => {
      const projectId = resolveProjectContextId(project);
      if (!projectId) return false;

      const previous = currentEntry(projectId);
      patchEntry(projectId, { plans: previous.plans.filter((plan) => plan.id !== planId), error: null });

      const flags = flagsFor(projectId);
      flags.plans = true;

      try {
        const context = await enqueueWrite(projectId, () => deleteProjectPlan(project, planId));
        patchEntry(projectId, { plans: context.plans });
        return true;
      } catch (error) {
        patchEntry(projectId, {
          plans: previous.plans,
          error: errorMessage(error, 'Failed to delete plan'),
        });
        return false;
      } finally {
        flags.plans = false;
      }
    },

    /** Drop every cached project. Used when the active runtime changes. */
    reset: () => {
      writeChains.clear();
      mutationFlags.clear();
      set({ entries: {} });
    },
  };
});
