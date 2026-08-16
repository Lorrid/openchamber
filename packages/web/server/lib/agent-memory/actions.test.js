import { beforeEach, describe, expect, test } from 'bun:test';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAgentMemoryActions } from './actions.js';
import { createAgentMemoryRuntime } from './runtime.js';
import { createProjectIdFromPath } from '../projects/project-id.js';

const DIRECTORY = '/tmp/some-project';

class TestError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let actions;
let runtime;

beforeEach(async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-memory-actions-'));
  runtime = createAgentMemoryRuntime({
    fsPromises,
    path,
    userConfigRoot: path.join(rootDir, 'config'),
    projectsDirPath: path.join(rootDir, 'config', 'projects'),
  });
  actions = createAgentMemoryActions({
    agentMemoryRuntime: runtime,
    createError: (message, status) => new TestError(message, status),
  });
});

describe('scope', () => {
  test('project scope files against the session directory, not a model-supplied id', async () => {
    await actions.execute('memory.save', {
      scope: 'project',
      title: 'Uses bun',
      body: 'Tests run with bun test.',
      projectId: 'path_somewhere_else',
    }, DIRECTORY);

    const stored = await runtime.read({
      scope: 'project',
      projectId: createProjectIdFromPath(DIRECTORY),
    });
    expect(stored.entries.map((entry) => entry.title)).toEqual(['Uses bun']);
  });

  test('project scope without a session directory fails instead of writing global', async () => {
    await expect(actions.execute('memory.save', { scope: 'project', title: 'T', body: 'b' }, null))
      .rejects.toThrow('needs a session directory');
    expect((await runtime.read({ scope: 'global' })).entries).toHaveLength(0);
  });

  test('an unknown scope is rejected', async () => {
    await expect(actions.execute('memory.save', { scope: 'team', title: 'T', body: 'b' }, DIRECTORY))
      .rejects.toThrow('scope must be global or project');
  });

  test('an unknown action is rejected', async () => {
    await expect(actions.execute('memory.forget', {}, DIRECTORY)).rejects.toThrow('Unsupported memory action');
  });
});

describe('save', () => {
  test('requires title and body', async () => {
    await expect(actions.execute('memory.save', { scope: 'global', body: 'b' }, DIRECTORY))
      .rejects.toThrow('title is required');
    await expect(actions.execute('memory.save', { scope: 'global', title: 't' }, DIRECTORY))
      .rejects.toThrow('body is required');
  });

  test('rejects an unknown type', async () => {
    await expect(actions.execute('memory.save', {
      scope: 'global', title: 't', body: 'b', type: 'nonsense',
    }, DIRECTORY)).rejects.toThrow('type must be');
  });

  test('reports a correction as replaced so the agent does not claim a second memory', async () => {
    await actions.execute('memory.save', {
      scope: 'global',
      title: 'Prefers Ukrainian replies',
      body: 'The user wants answers written in Ukrainian.',
    }, DIRECTORY);

    const result = await actions.execute('memory.save', {
      scope: 'global',
      title: 'Answers should be in Ukrainian',
      body: 'The user wants replies written in Ukrainian.',
    }, DIRECTORY);

    expect(result.replaced).toBe(true);
    expect((await runtime.read({ scope: 'global' })).entries).toHaveLength(1);
  });

  test('what the agent saves starts unreviewed', async () => {
    const result = await actions.execute('memory.save', {
      scope: 'global', title: 'T', body: 'Something learned.',
    }, DIRECTORY);

    expect(result.memory.reviewed).toBe(false);
  });
});

describe('read', () => {
  test('reads by the title the session index shows', async () => {
    await actions.execute('memory.save', { scope: 'global', title: 'Uses bun', body: 'Full text here.' }, DIRECTORY);

    const result = await actions.execute('memory.read', { scope: 'global', title: 'uses BUN' }, DIRECTORY);

    expect(result.memory.body).toBe('Full text here.');
  });

  test('reads by id', async () => {
    const saved = await actions.execute('memory.save', { scope: 'global', title: 'T', body: 'Full text.' }, DIRECTORY);

    const result = await actions.execute('memory.read', {
      scope: 'global', memoryId: saved.memory.memoryId,
    }, DIRECTORY);

    expect(result.memory.body).toBe('Full text.');
  });

  test('requires something to look up', async () => {
    await expect(actions.execute('memory.read', { scope: 'global' }, DIRECTORY))
      .rejects.toThrow('requires memoryId or title');
  });

  test('a miss is reported, not answered with an empty memory', async () => {
    await expect(actions.execute('memory.read', { scope: 'global', title: 'absent' }, DIRECTORY))
      .rejects.toThrow('No memory matches');
  });

  test('does not reach across scopes', async () => {
    await actions.execute('memory.save', { scope: 'project', title: 'Uses bun', body: 'x' }, DIRECTORY);

    await expect(actions.execute('memory.read', { scope: 'global', title: 'Uses bun' }, DIRECTORY))
      .rejects.toThrow('No memory matches');
  });
});

describe('list', () => {
  test('lists both scopes by default and labels which is which', async () => {
    await actions.execute('memory.save', { scope: 'global', title: 'About user', body: 'x' }, DIRECTORY);
    await actions.execute('memory.save', { scope: 'project', title: 'About project', body: 'y' }, DIRECTORY);

    const result = await actions.execute('memory.list', {}, DIRECTORY);

    expect(result.memories.map((memory) => [memory.title, memory.scope])).toEqual([
      ['About user', 'global'],
      ['About project', 'project'],
    ]);
  });

  test('listing never carries bodies', async () => {
    await actions.execute('memory.save', { scope: 'global', title: 'T', body: 'Long body text.' }, DIRECTORY);

    const result = await actions.execute('memory.list', { scope: 'global' }, DIRECTORY);

    expect(result.memories[0].body).toBeUndefined();
  });

  test('a broken scope is reported rather than shown as empty', async () => {
    const failing = createAgentMemoryActions({
      agentMemoryRuntime: {
        readAll: async () => ({ global: [], project: [], globalFailed: true, projectFailed: false }),
      },
      createError: (message, status) => new TestError(message, status),
    });

    const result = await failing.execute('memory.list', {}, DIRECTORY);

    expect(result.globalUnavailable).toBe(true);
  });
});

describe('delete', () => {
  test('removes the entry', async () => {
    const saved = await actions.execute('memory.save', { scope: 'global', title: 'T', body: 'b' }, DIRECTORY);

    await actions.execute('memory.delete', { scope: 'global', memoryId: saved.memory.memoryId }, DIRECTORY);

    expect((await runtime.read({ scope: 'global' })).entries).toHaveLength(0);
  });

  test('requires an id', async () => {
    await expect(actions.execute('memory.delete', { scope: 'global' }, DIRECTORY))
      .rejects.toThrow('memoryId is required');
  });

  test('reports a miss instead of claiming success', async () => {
    await expect(actions.execute('memory.delete', { scope: 'global', memoryId: 'absent' }, DIRECTORY))
      .rejects.toThrow('No memory has that id');
  });
});
