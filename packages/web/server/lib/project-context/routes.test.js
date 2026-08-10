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

const emptyContext = { version: 1, notes: '', todos: [], plans: [] };

const createRuntimeStub = (overrides = {}) => ({
  readContext: async () => emptyContext,
  saveNotesAndTodos: async () => emptyContext,
  readPlan: async () => null,
  createPlan: async () => ({ plan: { id: 'p1', file: 'a.md', title: 'A', createdAt: 1 }, context: emptyContext }),
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

  it('rejects a non-object notes-todos body', async () => {
    const registry = setup();

    const res = await registry.call('PUT', '/api/project-context/:projectId/notes-todos', {
      params: { projectId: 'path_x' },
      body: 'nope',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed todo shapes', async () => {
    const registry = setup();

    const res = await registry.call('PUT', '/api/project-context/:projectId/notes-todos', {
      params: { projectId: 'path_x' },
      body: { notes: '', todos: [{ id: 1, text: 'bad id type' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('saves notes and todos and returns the committed context', async () => {
    let received = null;
    const registry = setup({
      saveNotesAndTodos: async (_projectId, value) => {
        received = value;
        return { ...emptyContext, notes: value.notes };
      },
    });

    const res = await registry.call('PUT', '/api/project-context/:projectId/notes-todos', {
      params: { projectId: 'path_x' },
      body: { notes: 'saved', todos: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.notes).toBe('saved');
    expect(received).toEqual({ notes: 'saved', todos: [] });
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

  it('returns 404 when deleting a plan that does not exist', async () => {
    const registry = setup({ deletePlan: async () => ({ deleted: false, context: emptyContext }) });

    const res = await registry.call('DELETE', '/api/project-context/:projectId/plans/:planId', {
      params: { projectId: 'path_x', planId: 'nope' },
    });
    expect(res.statusCode).toBe(404);
  });
});
