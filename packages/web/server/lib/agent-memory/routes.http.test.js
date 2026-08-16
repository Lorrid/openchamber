import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { registerAgentMemoryRoutes } from './routes.js';

/**
 * End-to-end route tests over real HTTP.
 *
 * Mounted on a bare express app with no global JSON parser, exactly as
 * production runs: `core-routes` parses only an allowlist of path prefixes so
 * the OpenCode proxy keeps an unread stream. The sibling project-context routes
 * shipped with every write rejected as malformed because their tests called the
 * handlers directly and never saw the missing parser. These tests would fail
 * the same way instead of the user.
 */

const entry = (overrides = {}) => ({
  id: 'mem-1',
  title: 'Uses bun',
  body: 'Tests run with bun test.',
  type: 'fact',
  createdAt: 1,
  updatedAt: 1,
  reviewed: false,
  ...overrides,
});

const createApp = (overrides = {}) => {
  const received = {};
  const runtime = {
    read: async (target) => {
      received.readTarget = target;
      return { version: 1, entries: [entry()] };
    },
    readAll: async (projectId) => {
      received.readAllProjectId = projectId;
      return { global: [entry()], project: [], globalFailed: false, projectFailed: false };
    },
    create: async (target, value) => {
      received.createTarget = target;
      received.created = value;
      return { entry: entry(value), entries: [entry(value)], replaced: false };
    },
    update: async (target, memoryId, patch) => {
      received.updateTarget = target;
      received.memoryId = memoryId;
      received.patch = patch;
      return { entry: entry(patch), entries: [entry(patch)] };
    },
    remove: async (target, memoryId) => {
      received.removeTarget = target;
      received.removedId = memoryId;
      return { deleted: true, entries: [] };
    },
    ...overrides.runtime,
  };

  const app = express();
  // Deliberately no app.use(express.json()) — see the file header.
  registerAgentMemoryRoutes(app, {
    agentMemoryRuntime: runtime,
    isAgentMemoryEnabled: overrides.isAgentMemoryEnabled,
  });
  return { app, received };
};

describe('agent memory routes parse their own bodies', () => {
  it('creates a memory from a JSON body', async () => {
    const { app, received } = createApp();

    const response = await request(app)
      .post('/api/agent-memory?scope=global')
      .send({ title: 'Speaks Ukrainian', body: 'Replies should be in Ukrainian.' });

    expect(response.status).toBe(201);
    expect(received.created.title).toBe('Speaks Ukrainian');
  });

  it('patches a memory from a JSON body', async () => {
    const { app, received } = createApp();

    const response = await request(app)
      .patch('/api/agent-memory/mem-1?scope=project&projectId=path_abc')
      .send({ reviewed: true });

    expect(response.status).toBe(200);
    expect(received.patch).toEqual({ reviewed: true });
    expect(received.memoryId).toBe('mem-1');
  });
});

describe('scope resolution', () => {
  it('reads global scope', async () => {
    const { app, received } = createApp();

    const response = await request(app).get('/api/agent-memory?scope=global');

    expect(response.status).toBe(200);
    expect(received.readTarget).toEqual({ scope: 'global' });
  });

  it('reads project scope with its id', async () => {
    const { app, received } = createApp();

    await request(app).get('/api/agent-memory?scope=project&projectId=path_abc');

    expect(received.readTarget).toEqual({ scope: 'project', projectId: 'path_abc' });
  });

  it('refuses a project scope with no id rather than falling back to global', async () => {
    const { app, received } = createApp();

    const response = await request(app).get('/api/agent-memory?scope=project');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('projectId is required');
    expect(received.readTarget).toBeUndefined();
  });

  it('refuses a missing scope', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/agent-memory');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('scope must be');
  });

  it('refuses a write with no scope before touching the store', async () => {
    const { app, received } = createApp();

    const response = await request(app)
      .post('/api/agent-memory')
      .send({ title: 'T', body: 'b' });

    expect(response.status).toBe(400);
    expect(received.created).toBeUndefined();
  });
});

describe('both scopes at once', () => {
  it('returns global and project together', async () => {
    const { app, received } = createApp();

    const response = await request(app).get('/api/agent-memory/all?projectId=path_abc');

    expect(response.status).toBe(200);
    expect(received.readAllProjectId).toBe('path_abc');
    expect(response.body.global).toHaveLength(1);
  });

  it('reads global alone when no project is open', async () => {
    const { app, received } = createApp();

    await request(app).get('/api/agent-memory/all');

    expect(received.readAllProjectId).toBeNull();
  });
});

describe('validation', () => {
  it('rejects a non-string title', async () => {
    const { app } = createApp();

    const response = await request(app)
      .post('/api/agent-memory?scope=global')
      .send({ title: 42, body: 'b' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('title must be a string');
  });

  it('rejects an unknown type', async () => {
    const { app } = createApp();

    const response = await request(app)
      .post('/api/agent-memory?scope=global')
      .send({ title: 'T', body: 'b', type: 'nonsense' });

    expect(response.status).toBe(400);
  });

  it('rejects a non-boolean reviewed', async () => {
    const { app } = createApp();

    const response = await request(app)
      .patch('/api/agent-memory/mem-1?scope=global')
      .send({ reviewed: 'yes' });

    expect(response.status).toBe(400);
  });

  it('reports a full store as a client error, not a crash', async () => {
    const { app } = createApp({
      runtime: {
        create: async () => { throw new Error('global memory holds at most 60 entries'); },
      },
    });

    const response = await request(app)
      .post('/api/agent-memory?scope=global')
      .send({ title: 'T', body: 'b' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('at most 60');
  });

  it('reports malformed storage as a server error', async () => {
    const { app } = createApp({
      runtime: {
        read: async () => { throw new Error('Stored agent memory is malformed'); },
      },
    });

    const response = await request(app).get('/api/agent-memory?scope=global');

    expect(response.status).toBe(500);
  });
});

describe('outcomes', () => {
  it('answers a replacement with 200 so the client can tell it from a new memory', async () => {
    const { app } = createApp({
      runtime: {
        create: async (_target, value) => ({ entry: entry(value), entries: [entry(value)], replaced: true }),
      },
    });

    const response = await request(app)
      .post('/api/agent-memory?scope=global')
      .send({ title: 'T', body: 'b' });

    expect(response.status).toBe(200);
    expect(response.body.replaced).toBe(true);
  });

  it('reports a missing memory as 404 on patch', async () => {
    const { app } = createApp({ runtime: { update: async () => null } });

    const response = await request(app)
      .patch('/api/agent-memory/nope?scope=global')
      .send({ reviewed: true });

    expect(response.status).toBe(404);
  });

  it('reports a missing memory as 404 on delete', async () => {
    const { app } = createApp({ runtime: { remove: async () => ({ deleted: false, entries: [] }) } });

    const response = await request(app).delete('/api/agent-memory/nope?scope=global');

    expect(response.status).toBe(404);
  });
});

describe('the settings toggle disables the surface, not just its UI', () => {
  it('refuses reads while memory is off', async () => {
    const { app, received } = createApp({ isAgentMemoryEnabled: () => false });

    const response = await request(app).get('/api/agent-memory?scope=global');

    expect(response.status).toBe(404);
    expect(received.readTarget).toBeUndefined();
  });

  it('refuses writes from a stale client while memory is off', async () => {
    const { app, received } = createApp({ isAgentMemoryEnabled: () => false });

    const response = await request(app)
      .post('/api/agent-memory?scope=global')
      .send({ title: 'T', body: 'b' });

    expect(response.status).toBe(404);
    expect(received.created).toBeUndefined();
  });

  it('serves normally while memory is on', async () => {
    const { app } = createApp({ isAgentMemoryEnabled: () => true });

    const response = await request(app).get('/api/agent-memory?scope=global');

    expect(response.status).toBe(200);
  });

  it('honours a gate that resolves asynchronously', async () => {
    // The real gate reads the settings file. A synchronous truthiness test on
    // its promise would leave the surface open with memory turned off.
    const { app, received } = createApp({ isAgentMemoryEnabled: async () => false });

    const response = await request(app).get('/api/agent-memory?scope=global');

    expect(response.status).toBe(404);
    expect(received.readTarget).toBeUndefined();
  });

  it('closes the surface when the setting cannot be read', async () => {
    const { app, received } = createApp({
      isAgentMemoryEnabled: async () => { throw new Error('settings unreadable'); },
    });

    const response = await request(app).get('/api/agent-memory?scope=global');

    expect(response.status).toBe(503);
    expect(received.readTarget).toBeUndefined();
  });
});
