import { beforeEach, describe, expect, mock, test } from 'bun:test';

interface ContextPayload {
  notes: string;
  todos: { id: string; text: string; completed: boolean; createdAt: number }[];
  plans: { id: string; file: string; title: string; createdAt: number }[];
}

const emptyPayload = (): ContextPayload => ({ notes: '', todos: [], plans: [] });

// The UI tsconfig does not load bun's test globals, so these tests follow the
// local precedent of swapping plain handlers instead of using mock helpers.
const handlers = {
  fetch: async (): Promise<ContextPayload> => emptyPayload(),
  save: async (_project: unknown, value: { notes: string; todos: ContextPayload['todos'] }): Promise<ContextPayload> => ({
    notes: value.notes,
    todos: value.todos,
    plans: [],
  }),
  create: async (): Promise<{ plan: ContextPayload['plans'][number]; context: ContextPayload }> => ({
    plan: { id: 'p1', file: 'a.md', title: 'A', createdAt: 1 },
    context: { notes: '', todos: [], plans: [{ id: 'p1', file: 'a.md', title: 'A', createdAt: 1 }] },
  }),
  update: async (): Promise<{ plan: ContextPayload['plans'][number]; raw: string } | null> => ({
    plan: { id: 'p1', file: 'a.md', title: 'A', createdAt: 1 },
    raw: '# A',
  }),
  remove: async (): Promise<ContextPayload> => emptyPayload(),
};

const calls = { fetch: 0, save: 0, create: 0, update: 0, remove: 0 };

mock.module('@/lib/projectContextApi', () => ({
  fetchProjectContext: () => {
    calls.fetch += 1;
    return handlers.fetch();
  },
  saveProjectNotesAndTodos: (project: unknown, value: { notes: string; todos: ContextPayload['todos'] }) => {
    calls.save += 1;
    return handlers.save(project, value);
  },
  createProjectPlan: () => {
    calls.create += 1;
    return handlers.create();
  },
  updateProjectPlan: () => {
    calls.update += 1;
    return handlers.update();
  },
  deleteProjectPlan: () => {
    calls.remove += 1;
    return handlers.remove();
  },
  resolveProjectContextId: (project: { path?: string } | null | undefined) => (
    project?.path ? `path_${project.path}` : ''
  ),
}));

const { useProjectContextStore } = await import('./useProjectContextStore');

const PROJECT = { id: 'ignored', path: '/repo' };
const store = () => useProjectContextStore.getState();
const entry = () => store().getEntry(PROJECT);

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};

const failWith = (message: string) => async (): Promise<never> => {
  throw new Error(message);
};

beforeEach(() => {
  store().reset();
  calls.fetch = 0;
  calls.save = 0;
  calls.create = 0;
  calls.update = 0;
  calls.remove = 0;

  handlers.fetch = async () => emptyPayload();
  handlers.save = async (_project, value) => ({ notes: value.notes, todos: value.todos, plans: [] });
  handlers.create = async () => ({
    plan: { id: 'p1', file: 'a.md', title: 'A', createdAt: 1 },
    context: { notes: '', todos: [], plans: [{ id: 'p1', file: 'a.md', title: 'A', createdAt: 1 }] },
  });
  handlers.update = async () => ({ plan: { id: 'p1', file: 'a.md', title: 'A', createdAt: 1 }, raw: '# A' });
  handlers.remove = async () => emptyPayload();
});

describe('getEntry', () => {
  test('returns a stable empty entry for an unknown project', () => {
    expect(entry()).toEqual({ notes: '', todos: [], plans: [], loaded: false, loading: false, error: null });
  });

  test('returns the empty entry for a project without a path', () => {
    expect(store().getEntry({ id: 'x', path: '' }).loaded).toBe(false);
  });
});

describe('load', () => {
  test('populates from the server', async () => {
    handlers.fetch = async () => ({
      notes: 'server notes',
      todos: [{ id: 't1', text: 'a', completed: false, createdAt: 1 }],
      plans: [{ id: 'p1', file: 'a.md', title: 'A', createdAt: 1 }],
    });

    await store().load(PROJECT);

    expect(entry().notes).toBe('server notes');
    expect(entry().todos).toHaveLength(1);
    expect(entry().plans).toHaveLength(1);
    expect(entry().loaded).toBe(true);
    expect(entry().error).toBeNull();
  });

  test('does not refetch once loaded', async () => {
    await store().load(PROJECT);
    await store().load(PROJECT);
    expect(calls.fetch).toBe(1);
  });

  test('refetches when forced', async () => {
    await store().load(PROJECT);
    await store().load(PROJECT, { force: true });
    expect(calls.fetch).toBe(2);
  });

  test('a failed load preserves previously loaded data instead of clearing it', async () => {
    handlers.fetch = async () => ({ notes: 'kept', todos: [], plans: [] });
    await store().load(PROJECT);

    handlers.fetch = failWith('offline');
    await store().load(PROJECT, { force: true });

    expect(entry().notes).toBe('kept');
    expect(entry().loaded).toBe(true);
    expect(entry().error).toBe('offline');
  });

  test('a first-load failure reports the error and stays unloaded', async () => {
    handlers.fetch = failWith('boom');

    await store().load(PROJECT);

    expect(entry().loaded).toBe(false);
    expect(entry().notes).toBe('');
    expect(entry().error).toBe('boom');
  });

  test('concurrent loads issue a single request', async () => {
    await Promise.all([store().load(PROJECT), store().load(PROJECT), store().load(PROJECT)]);
    expect(calls.fetch).toBe(1);
  });
});

describe('saveNotesAndTodos', () => {
  test('applies optimistically before the request resolves', async () => {
    const gate = deferred<ContextPayload>();
    handlers.save = () => gate.promise;

    const pending = store().saveNotesAndTodos(PROJECT, { notes: 'typed', todos: [] });
    expect(entry().notes).toBe('typed');

    gate.resolve({ notes: 'typed', todos: [], plans: [] });
    expect(await pending).toBe(true);
    expect(entry().notes).toBe('typed');
  });

  test('rolls back and reports the error on failure', async () => {
    await store().saveNotesAndTodos(PROJECT, { notes: 'original', todos: [] });
    handlers.save = failWith('disk full');

    expect(await store().saveNotesAndTodos(PROJECT, { notes: 'doomed', todos: [] })).toBe(false);
    expect(entry().notes).toBe('original');
    expect(entry().error).toBe('disk full');
  });

  test('serializes concurrent saves in call order', async () => {
    const order: string[] = [];
    handlers.save = async (_project, value) => {
      order.push(`start:${value.notes}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end:${value.notes}`);
      return { notes: value.notes, todos: value.todos, plans: [] };
    };

    await Promise.all([
      store().saveNotesAndTodos(PROJECT, { notes: 'first', todos: [] }),
      store().saveNotesAndTodos(PROJECT, { notes: 'second', todos: [] }),
    ]);

    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    expect(entry().notes).toBe('second');
  });

  test('a load that resolves during an in-flight save does not clobber the save', async () => {
    const gate = deferred<ContextPayload>();
    handlers.save = () => gate.promise;
    handlers.fetch = async () => ({ notes: 'stale server value', todos: [], plans: [] });

    const pendingSave = store().saveNotesAndTodos(PROJECT, { notes: 'local edit', todos: [] });
    await store().load(PROJECT);

    expect(entry().notes).toBe('local edit');

    gate.resolve({ notes: 'local edit', todos: [], plans: [] });
    await pendingSave;
    expect(entry().notes).toBe('local edit');
  });

  test('a load during an in-flight save still applies plans it did not conflict with', async () => {
    const gate = deferred<ContextPayload>();
    handlers.save = () => gate.promise;
    handlers.fetch = async () => ({
      notes: 'stale',
      todos: [],
      plans: [{ id: 'p9', file: 'z.md', title: 'Z', createdAt: 9 }],
    });

    const pendingSave = store().saveNotesAndTodos(PROJECT, { notes: 'local', todos: [] });
    await store().load(PROJECT);

    expect(entry().notes).toBe('local');
    expect(entry().plans.map((plan) => plan.id)).toEqual(['p9']);

    gate.resolve({ notes: 'local', todos: [], plans: [] });
    await pendingSave;
  });

  test('ignores a project without a resolvable path', async () => {
    expect(await store().saveNotesAndTodos({ id: 'x', path: '' }, { notes: 'x', todos: [] })).toBe(false);
    expect(calls.save).toBe(0);
  });
});

describe('appendNotes', () => {
  test('loads first, then appends on a new line', async () => {
    handlers.fetch = async () => ({ notes: 'existing', todos: [], plans: [] });

    expect(await store().appendNotes(PROJECT, 'added')).toBe(true);
    expect(entry().notes).toBe('existing\nadded');
  });

  test('does not add a separator when there are no notes yet', async () => {
    expect(await store().appendNotes(PROJECT, 'first note')).toBe(true);
    expect(entry().notes).toBe('first note');
  });

  test('ignores whitespace-only additions', async () => {
    expect(await store().appendNotes(PROJECT, '   ')).toBe(false);
    expect(calls.save).toBe(0);
  });

  test('does not write when the preceding load failed', async () => {
    handlers.fetch = failWith('offline');

    expect(await store().appendNotes(PROJECT, 'lost')).toBe(false);
    expect(calls.save).toBe(0);
  });
});

describe('plans', () => {
  test('createPlan commits the server context', async () => {
    const plan = await store().createPlan(PROJECT, { title: 'A', body: 'x' });

    expect(plan?.id).toBe('p1');
    expect(entry().plans.map((item) => item.id)).toEqual(['p1']);
  });

  test('createPlan reports failure without inserting a placeholder row', async () => {
    handlers.create = failWith('no space');

    expect(await store().createPlan(PROJECT, { title: 'A', body: 'x' })).toBeNull();
    expect(entry().plans).toEqual([]);
    expect(entry().error).toBe('no space');
  });

  test('deletePlan removes optimistically', async () => {
    await store().createPlan(PROJECT, { title: 'A', body: 'x' });

    const gate = deferred<ContextPayload>();
    handlers.remove = () => gate.promise;

    const pending = store().deletePlan(PROJECT, 'p1');
    expect(entry().plans).toEqual([]);

    gate.resolve(emptyPayload());
    expect(await pending).toBe(true);
  });

  test('savePlan folds the refreshed title back into the list', async () => {
    await store().createPlan(PROJECT, { title: 'A', body: 'x' });
    handlers.update = async () => ({ plan: { id: 'p1', file: 'a.md', title: 'Renamed', createdAt: 1 }, raw: '# Renamed' });

    expect(await store().savePlan(PROJECT, 'p1', '# Renamed')).toBe(true);
    expect(entry().plans[0].title).toBe('Renamed');
  });

  test('savePlan drops a plan the server reports as gone', async () => {
    await store().createPlan(PROJECT, { title: 'A', body: 'x' });
    handlers.update = async () => null;

    expect(await store().savePlan(PROJECT, 'p1', '# X')).toBe(false);
    expect(entry().plans).toEqual([]);
  });

  test('savePlan keeps the row and reports the error when the request fails', async () => {
    await store().createPlan(PROJECT, { title: 'A', body: 'x' });
    handlers.update = failWith('read only');

    expect(await store().savePlan(PROJECT, 'p1', '# X')).toBe(false);
    expect(entry().plans.map((item) => item.id)).toEqual(['p1']);
    expect(entry().error).toBe('read only');
  });

  test('deletePlan restores the row when the request fails', async () => {
    await store().createPlan(PROJECT, { title: 'A', body: 'x' });
    handlers.remove = failWith('locked');

    expect(await store().deletePlan(PROJECT, 'p1')).toBe(false);
    expect(entry().plans.map((item) => item.id)).toEqual(['p1']);
    expect(entry().error).toBe('locked');
  });
});

describe('reset', () => {
  test('drops every cached project', async () => {
    await store().load(PROJECT);
    expect(entry().loaded).toBe(true);

    store().reset();
    expect(entry().loaded).toBe(false);
  });
});
