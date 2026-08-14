import { describe, expect, it } from 'vitest';

import { registerProjectContextRoutes } from './routes.js';

const createRouteRegistry = () => {
  const routes = new Map();
  const register = (method) => (routePath, handler) => {
    routes.set(`${method} ${routePath}`, handler);
  };

  return {
    app: {
      get: register('GET'),
      put: register('PUT'),
      patch: register('PATCH'),
      post: register('POST'),
      delete: register('DELETE'),
    },
    call(method, routePath, { params = {}, body } = {}) {
      const handler = routes.get(`${method} ${routePath}`);
      if (!handler) {
        throw new Error(`route not registered: ${method} ${routePath}`);
      }
      const res = createMockResponse();
      return handler({ params, body }, res).then(() => res);
    },
  };
};

const createMockResponse = () => {
  let statusCode = 200;
  let payload = null;

  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return payload;
    },
  };
};

const emptyContext = { version: 2, notes: [], todos: [], plans: [] };

const createRuntimeStub = (overrides = {}) => ({
  readContext: async () => emptyContext,
  saveTodos: async () => emptyContext,
  createNote: async () => ({ note: { id: 'n1', body: 'x', createdAt: 1, updatedAt: 1, source: 'manual', pinned: false }, context: emptyContext }),
  updateNote: async () => ({ note: { id: 'n1', body: 'x', createdAt: 1, updatedAt: 2, source: 'manual', pinned: true }, context: emptyContext }),
  deleteNote: async () => ({ deleted: true, context: emptyContext }),
  setPlanPinned: async () => ({ plan: { id: 'p1', file: 'a.md', title: 'A', createdAt: 1, pinned: true }, context: emptyContext }),
  readPlan: async () => null,
  createPlan: async () => ({ plan: { id: 'p1', file: 'a.md', title: 'A', createdAt: 1 }, context: emptyContext }),
  updatePlan: async () => ({
    plan: { id: 'p1', file: 'a.md', title: 'A', createdAt: 1 },
    context: emptyContext,
    title: 'A',
    body: 'x',
    raw: '# A\n\nx',
  }),
  deletePlan: async () => ({ deleted: true, context: emptyContext }),
  ...overrides,
});

const setup = (overrides) => {
  const registry = createRouteRegistry();
  registerProjectContextRoutes(registry.app, { projectContextRuntime: createRuntimeStub(overrides) });
  return registry;
};

describe('project context routes', () => {
  it('returns the stored context', async () => {
    const registry = setup({ readContext: async () => ({ ...emptyContext, notes: 'hi' }) });

    const res = await registry.call('GET', '/api/project-context/:projectId', { params: { projectId: 'path_x' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.notes).toBe('hi');
  });

  it('maps an invalid projectId to 400, not 500', async () => {
    const registry = setup({
      readContext: async () => {
        throw new Error('projectId contains unsupported characters');
      },
    });

    const res = await registry.call('GET', '/api/project-context/:projectId', { params: { projectId: '../x' } });
    expect(res.statusCode).toBe(400);
  });

  it('surfaces malformed stored context as a server error rather than empty data', async () => {
    const registry = setup({
      readContext: async () => {
        throw new Error('Stored project context is malformed');
      },
    });

    const res = await registry.call('GET', '/api/project-context/:projectId', { params: { projectId: 'path_x' } });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Stored project context is malformed' });
  });

  it('rejects a non-object todos body', async () => {
    const registry = setup();

    const res = await registry.call('PUT', '/api/project-context/:projectId/todos', {
      params: { projectId: 'path_x' },
      body: 'nope',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed todo shapes', async () => {
    const registry = setup();

    const res = await registry.call('PUT', '/api/project-context/:projectId/todos', {
      params: { projectId: 'path_x' },
      body: { todos: [{ id: 1, text: 'bad id type' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('saves todos and returns the committed context', async () => {
    let received = null;
    const registry = setup({
      saveTodos: async (_projectId, todos) => {
        received = todos;
        return { ...emptyContext, todos };
      },
    });

    const res = await registry.call('PUT', '/api/project-context/:projectId/todos', {
      params: { projectId: 'path_x' },
      body: { todos: [{ id: 't1', text: 'one' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(received).toEqual([{ id: 't1', text: 'one' }]);
  });

  it('creates a note with 201', async () => {
    const registry = setup();

    const res = await registry.call('POST', '/api/project-context/:projectId/notes', {
      params: { projectId: 'path_x' },
      body: { body: 'hello' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.note.id).toBe('n1');
  });

  it('rejects a note create without a string body', async () => {
    const registry = setup();

    const res = await registry.call('POST', '/api/project-context/:projectId/notes', {
      params: { projectId: 'path_x' },
      body: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown note source', async () => {
    const registry = setup();

    const res = await registry.call('POST', '/api/project-context/:projectId/notes', {
      params: { projectId: 'path_x' },
      body: { body: 'hello', source: 'somewhere-else' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('forwards only the note fields that were supplied', async () => {
    let received = null;
    const registry = setup({
      updateNote: async (_projectId, _noteId, patch) => {
        received = patch;
        return { note: { id: 'n1', body: 'x', createdAt: 1, updatedAt: 2, source: 'manual', pinned: true }, context: emptyContext };
      },
    });

    const res = await registry.call('PATCH', '/api/project-context/:projectId/notes/:noteId', {
      params: { projectId: 'path_x', noteId: 'n1' },
      body: { pinned: true },
    });
    expect(res.statusCode).toBe(200);
    expect(received).toEqual({ pinned: true });
  });

  it('returns 404 when patching a note that does not exist', async () => {
    const registry = setup({ updateNote: async () => null });

    const res = await registry.call('PATCH', '/api/project-context/:projectId/notes/:noteId', {
      params: { projectId: 'path_x', noteId: 'nope' },
      body: { body: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when deleting a note that does not exist', async () => {
    const registry = setup({ deleteNote: async () => ({ deleted: false, context: emptyContext }) });

    const res = await registry.call('DELETE', '/api/project-context/:projectId/notes/:noteId', {
      params: { projectId: 'path_x', noteId: 'nope' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a plan pin patch without a boolean', async () => {
    const registry = setup();

    const res = await registry.call('PATCH', '/api/project-context/:projectId/plans/:planId', {
      params: { projectId: 'path_x', planId: 'p1' },
      body: { pinned: 'yes' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('pins a plan', async () => {
    const registry = setup();

    const res = await registry.call('PATCH', '/api/project-context/:projectId/plans/:planId', {
      params: { projectId: 'path_x', planId: 'p1' },
      body: { pinned: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.plan.pinned).toBe(true);
  });

  it('returns 404 for an unknown plan', async () => {
    const registry = setup();

    const res = await registry.call('GET', '/api/project-context/:projectId/plans/:planId', {
      params: { projectId: 'path_x', planId: 'nope' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('creates a plan with 201 and returns the new link', async () => {
    const registry = setup();

    const res = await registry.call('POST', '/api/project-context/:projectId/plans', {
      params: { projectId: 'path_x' },
      body: { title: 'A', body: 'text' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.plan.id).toBe('p1');
  });

  it('rejects a plan create without a string body', async () => {
    const registry = setup();

    const res = await registry.call('POST', '/api/project-context/:projectId/plans', {
      params: { projectId: 'path_x' },
      body: { title: 'A' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('saves an edited plan and returns the new content', async () => {
    let received = null;
    const registry = setup({
      updatePlan: async (_projectId, _planId, value) => {
        received = value;
        return { plan: { id: 'p1', file: 'a.md', title: 'B', createdAt: 1 }, context: emptyContext, title: 'B', body: 'y', raw: '# B' };
      },
    });

    const res = await registry.call('PUT', '/api/project-context/:projectId/plans/:planId', {
      params: { projectId: 'path_x', planId: 'p1' },
      body: { raw: '# B' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.plan.title).toBe('B');
    expect(received).toEqual({ raw: '# B' });
  });

  it('rejects a plan save without raw content', async () => {
    const registry = setup();

    const res = await registry.call('PUT', '/api/project-context/:projectId/plans/:planId', {
      params: { projectId: 'path_x', planId: 'p1' },
      body: { body: 'wrong field' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when saving a plan whose markdown is gone', async () => {
    const registry = setup({ updatePlan: async () => null });

    const res = await registry.call('PUT', '/api/project-context/:projectId/plans/:planId', {
      params: { projectId: 'path_x', planId: 'p1' },
      body: { raw: '# B' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when deleting a plan that does not exist', async () => {
    const registry = setup({ deletePlan: async () => ({ deleted: false, context: emptyContext }) });

    const res = await registry.call('DELETE', '/api/project-context/:projectId/plans/:planId', {
      params: { projectId: 'path_x', planId: 'nope' },
    });
    expect(res.statusCode).toBe(404);
  });
});
