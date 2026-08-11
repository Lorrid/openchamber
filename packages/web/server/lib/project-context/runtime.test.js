import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createProjectContextRuntime, parsePlanMarkdown } from './runtime.js';

const PROJECT_ID = 'path_dGVzdA';

let projectsDirPath;
let runtime;
let idCounter;

const legacyConfigPath = () => path.join(projectsDirPath, `${PROJECT_ID}.json`);
const contextPath = () => path.join(projectsDirPath, PROJECT_ID, 'context.json');
const plansDir = () => path.join(projectsDirPath, PROJECT_ID, 'plans');

const writeJson = async (filePath, value) => {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
};

const readJson = async (filePath) => JSON.parse(await fsPromises.readFile(filePath, 'utf8'));

beforeEach(async () => {
  projectsDirPath = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-project-context-'));
  idCounter = 0;
  runtime = createProjectContextRuntime({
    fsPromises,
    path,
    projectsDirPath,
    createId: () => `plan-${++idCounter}`,
  });
});

afterEach(async () => {
  await fsPromises.rm(projectsDirPath, { recursive: true, force: true });
});

describe('projectId validation', () => {
  test('rejects traversal and empty ids', async () => {
    await expect(runtime.readContext('../escape')).rejects.toThrow('unsupported characters');
    await expect(runtime.readContext('a/b')).rejects.toThrow('unsupported characters');
    await expect(runtime.readContext('')).rejects.toThrow('projectId is required');
  });
});

describe('readContext', () => {
  test('missing file is authoritative empty', async () => {
    expect(await runtime.readContext(PROJECT_ID)).toEqual({
      version: 1,
      notes: '',
      todos: [],
      plans: [],
    });
  });

  test('malformed stored context fails instead of reading as empty', async () => {
    await fsPromises.mkdir(path.dirname(contextPath()), { recursive: true });
    await fsPromises.writeFile(contextPath(), '{ not json', 'utf8');
    await expect(runtime.readContext(PROJECT_ID)).rejects.toThrow('malformed');
  });

  test('drops malformed todo and plan entries without failing the read', async () => {
    await writeJson(contextPath(), {
      version: 1,
      notes: 'kept',
      todos: [{ id: 'a', text: 'ok', completed: false, createdAt: 1 }, { id: '', text: 'no id' }, { text: 'no id' }],
      plans: [
        { id: 'p1', file: 'a.md', title: 'A', createdAt: 2 },
        { id: 'p2', file: '../escape.md', title: 'Bad', createdAt: 3 },
        { id: 'p3', file: 'no-extension', createdAt: 4 },
      ],
    });

    const context = await runtime.readContext(PROJECT_ID);
    expect(context.notes).toBe('kept');
    expect(context.todos.map((todo) => todo.id)).toEqual(['a']);
    expect(context.plans.map((plan) => plan.id)).toEqual(['p1']);
  });

  test('clamps notes to the maximum length', async () => {
    await writeJson(contextPath(), { version: 1, notes: 'x'.repeat(5000), todos: [], plans: [] });
    expect((await runtime.readContext(PROJECT_ID)).notes).toHaveLength(3000);
  });
});

describe('legacy migration', () => {
  test('moves the three keys out of the client-owned config and preserves the rest', async () => {
    await fsPromises.mkdir(plansDir(), { recursive: true });
    await fsPromises.writeFile(path.join(plansDir(), '10-old.md'), '# Old plan\n\nbody here', 'utf8');
    await writeJson(legacyConfigPath(), {
      projectPath: '/tmp/test',
      'setup-worktree': ['bun install'],
      projectActions: [{ id: 'a', name: 'Dev', command: 'bun dev' }],
      projectNotes: 'legacy notes',
      projectTodos: [{ id: 't1', text: 'legacy todo', completed: true, createdAt: 5 }],
      projectPlanFiles: [{ id: 'p1', path: path.join(plansDir(), '10-old.md'), createdAt: 10 }],
    });

    const context = await runtime.readContext(PROJECT_ID);
    expect(context.notes).toBe('legacy notes');
    expect(context.todos).toEqual([{ id: 't1', text: 'legacy todo', completed: true, createdAt: 5 }]);
    expect(context.plans).toEqual([{ id: 'p1', file: '10-old.md', title: 'Old plan', createdAt: 10 }]);

    const remaining = await readJson(legacyConfigPath());
    expect(remaining).toEqual({
      projectPath: '/tmp/test',
      'setup-worktree': ['bun install'],
      projectActions: [{ id: 'a', name: 'Dev', command: 'bun dev' }],
    });
  });

  test('recovers a plan whose recorded path points outside the plans directory', async () => {
    const strayPath = path.join(projectsDirPath, 'stray.md');
    await fsPromises.writeFile(strayPath, '# Stray\n\nrecovered', 'utf8');
    await writeJson(legacyConfigPath(), {
      projectPlanFiles: [{ id: 'p1', path: strayPath, createdAt: 10 }],
    });

    const context = await runtime.readContext(PROJECT_ID);
    expect(context.plans).toEqual([{ id: 'p1', file: 'stray.md', title: 'Stray', createdAt: 10 }]);
    expect(await fsPromises.readFile(path.join(plansDir(), 'stray.md'), 'utf8')).toContain('recovered');
  });

  test('drops a link whose markdown no longer exists anywhere', async () => {
    await writeJson(legacyConfigPath(), {
      projectNotes: 'kept',
      projectPlanFiles: [{ id: 'gone', path: path.join(plansDir(), 'missing.md'), createdAt: 10 }],
    });

    const context = await runtime.readContext(PROJECT_ID);
    expect(context.notes).toBe('kept');
    expect(context.plans).toEqual([]);
  });

  test('does not run when the legacy config holds no context keys', async () => {
    await writeJson(legacyConfigPath(), { 'setup-worktree': ['bun install'] });

    expect(await runtime.readContext(PROJECT_ID)).toEqual({ version: 1, notes: '', todos: [], plans: [] });
    await expect(fsPromises.access(contextPath())).rejects.toThrow();
    expect(await readJson(legacyConfigPath())).toEqual({ 'setup-worktree': ['bun install'] });
  });

  test('is idempotent across repeated reads', async () => {
    await writeJson(legacyConfigPath(), { projectNotes: 'once', projectTodos: [] });

    const first = await runtime.readContext(PROJECT_ID);
    const second = await runtime.readContext(PROJECT_ID);
    expect(second).toEqual(first);
    expect(await readJson(legacyConfigPath())).toEqual({});
  });

  test('concurrent reads converge on the same migrated content', async () => {
    await writeJson(legacyConfigPath(), { projectNotes: 'concurrent', projectTodos: [] });

    const results = await Promise.all([
      runtime.readContext(PROJECT_ID),
      runtime.readContext(PROJECT_ID),
      runtime.readContext(PROJECT_ID),
    ]);
    for (const result of results) {
      expect(result.notes).toBe('concurrent');
    }
    expect((await readJson(contextPath())).notes).toBe('concurrent');
  });
});

describe('saveNotesAndTodos', () => {
  test('round-trips through disk', async () => {
    await runtime.saveNotesAndTodos(PROJECT_ID, {
      notes: 'hello',
      todos: [{ id: 't1', text: 'do it', completed: false, createdAt: 1 }],
    });

    const context = await runtime.readContext(PROJECT_ID);
    expect(context.notes).toBe('hello');
    expect(context.todos).toEqual([{ id: 't1', text: 'do it', completed: false, createdAt: 1 }]);
  });

  test('preserves plans it does not write', async () => {
    const { plan } = await runtime.createPlan(PROJECT_ID, { title: 'Keep me', body: 'x' });
    await runtime.saveNotesAndTodos(PROJECT_ID, { notes: 'n', todos: [] });

    expect((await runtime.readContext(PROJECT_ID)).plans.map((entry) => entry.id)).toEqual([plan.id]);
  });

  test('serializes concurrent writes without losing one', async () => {
    await Promise.all([
      runtime.saveNotesAndTodos(PROJECT_ID, { notes: 'a', todos: [{ id: '1', text: 'one', createdAt: 1 }] }),
      runtime.saveNotesAndTodos(PROJECT_ID, { notes: 'b', todos: [{ id: '2', text: 'two', createdAt: 2 }] }),
    ]);

    const context = await runtime.readContext(PROJECT_ID);
    expect(['a', 'b']).toContain(context.notes);
    expect(context.todos).toHaveLength(1);
  });

  test('clamps oversized notes and todo text', async () => {
    await runtime.saveNotesAndTodos(PROJECT_ID, {
      notes: 'y'.repeat(4000),
      todos: [{ id: 't1', text: 'z'.repeat(300), createdAt: 1 }],
    });

    const context = await runtime.readContext(PROJECT_ID);
    expect(context.notes).toHaveLength(3000);
    expect(context.todos[0].text).toHaveLength(120);
  });
});

describe('plans', () => {
  test('create writes markdown and returns a readable plan', async () => {
    const { plan } = await runtime.createPlan(PROJECT_ID, { title: 'My Plan', body: 'step one' });
    expect(plan.file).toMatch(/^\d+-my-plan\.md$/);

    const read = await runtime.readPlan(PROJECT_ID, plan.id);
    expect(read.title).toBe('My Plan');
    expect(read.body).toBe('step one');
    expect(read.raw).toBe('# My Plan\n\nstep one');
  });

  test('newest plan is listed first', async () => {
    const first = await runtime.createPlan(PROJECT_ID, { title: 'First', body: 'a' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await runtime.createPlan(PROJECT_ID, { title: 'Second', body: 'b' });

    const context = await runtime.readContext(PROJECT_ID);
    expect(context.plans.map((entry) => entry.id)).toEqual([second.plan.id, first.plan.id]);
  });

  test('reading an unknown plan returns null rather than throwing', async () => {
    expect(await runtime.readPlan(PROJECT_ID, 'nope')).toBeNull();
  });

  test('reading a plan whose markdown was deleted returns null', async () => {
    const { plan } = await runtime.createPlan(PROJECT_ID, { title: 'Doomed', body: 'x' });
    await fsPromises.rm(path.join(plansDir(), plan.file));

    expect(await runtime.readPlan(PROJECT_ID, plan.id)).toBeNull();
  });

  test('delete removes both the entry and the markdown', async () => {
    const { plan } = await runtime.createPlan(PROJECT_ID, { title: 'Bye', body: 'x' });

    const result = await runtime.deletePlan(PROJECT_ID, plan.id);
    expect(result.deleted).toBe(true);
    expect(result.context.plans).toEqual([]);
    await expect(fsPromises.access(path.join(plansDir(), plan.file))).rejects.toThrow();
  });

  test('deleting an unknown plan reports no deletion and keeps state', async () => {
    const { plan } = await runtime.createPlan(PROJECT_ID, { title: 'Stay', body: 'x' });

    const result = await runtime.deletePlan(PROJECT_ID, 'missing');
    expect(result.deleted).toBe(false);
    expect(result.context.plans.map((entry) => entry.id)).toEqual([plan.id]);
  });

  test('plans created in the same millisecond do not collide on a file name', async () => {
    const created = await Promise.all([
      runtime.createPlan(PROJECT_ID, { title: 'Same', body: 'a' }),
      runtime.createPlan(PROJECT_ID, { title: 'Same', body: 'b' }),
    ]);

    const files = new Set(created.map((entry) => entry.plan.file));
    expect(files.size).toBe(2);
    const context = await runtime.readContext(PROJECT_ID);
    expect(context.plans).toHaveLength(2);
  });

  test('update rewrites the markdown verbatim and re-derives the manifest title', async () => {
    const { plan } = await runtime.createPlan(PROJECT_ID, { title: 'Old', body: 'first' });

    const result = await runtime.updatePlan(PROJECT_ID, plan.id, { raw: '# New title\n\n- step\n- step two\n' });
    expect(result.plan.title).toBe('New title');
    expect(result.plan.file).toBe(plan.file);

    expect(await fsPromises.readFile(path.join(plansDir(), plan.file), 'utf8')).toBe('# New title\n\n- step\n- step two\n');
    expect((await runtime.readContext(PROJECT_ID)).plans[0].title).toBe('New title');
  });

  test('update keeps the file name when the title changes', async () => {
    const { plan } = await runtime.createPlan(PROJECT_ID, { title: 'Original', body: 'x' });

    await runtime.updatePlan(PROJECT_ID, plan.id, { raw: '# Totally different\n\nx' });

    const context = await runtime.readContext(PROJECT_ID);
    expect(context.plans[0].file).toBe(plan.file);
    expect(context.plans).toHaveLength(1);
  });

  test('update returns null for an unknown plan without writing anything', async () => {
    expect(await runtime.updatePlan(PROJECT_ID, 'missing', { raw: '# X' })).toBeNull();
    await expect(fsPromises.readdir(plansDir())).rejects.toThrow();
  });

  test('update refuses to recreate markdown deleted underneath it', async () => {
    const { plan } = await runtime.createPlan(PROJECT_ID, { title: 'Gone', body: 'x' });
    await fsPromises.rm(path.join(plansDir(), plan.file));

    expect(await runtime.updatePlan(PROJECT_ID, plan.id, { raw: '# Resurrected' })).toBeNull();
    await expect(fsPromises.access(path.join(plansDir(), plan.file))).rejects.toThrow();
  });

  test('update rejects a non-string payload', async () => {
    const { plan } = await runtime.createPlan(PROJECT_ID, { title: 'A', body: 'x' });
    await expect(runtime.updatePlan(PROJECT_ID, plan.id, {})).rejects.toThrow('raw is required');
  });

  test('update does not disturb notes or todos', async () => {
    await runtime.saveNotesAndTodos(PROJECT_ID, {
      notes: 'keep me',
      todos: [{ id: 't1', text: 'keep', completed: false, createdAt: 1 }],
    });
    const { plan } = await runtime.createPlan(PROJECT_ID, { title: 'A', body: 'x' });

    await runtime.updatePlan(PROJECT_ID, plan.id, { raw: '# B\n\ny' });

    const context = await runtime.readContext(PROJECT_ID);
    expect(context.notes).toBe('keep me');
    expect(context.todos).toHaveLength(1);
  });

  test('an untitled body still produces a titled markdown file', async () => {
    const { plan } = await runtime.createPlan(PROJECT_ID, { title: '', body: '' });
    const read = await runtime.readPlan(PROJECT_ID, plan.id);
    expect(read.title).toBe('Plan');
    expect(read.body).toBe('');
  });
});

describe('parsePlanMarkdown', () => {
  test('reads the leading heading as the title', () => {
    expect(parsePlanMarkdown('# Title\n\nbody')).toEqual({ title: 'Title', body: 'body' });
  });

  test('falls back to the first non-empty line', () => {
    expect(parsePlanMarkdown('\n\njust text\nmore')).toEqual({ title: 'just text', body: 'just text\nmore' });
  });

  test('normalizes CRLF input', () => {
    expect(parsePlanMarkdown('# Title\r\n\r\nbody')).toEqual({ title: 'Title', body: 'body' });
  });

  test('empty input yields the default title', () => {
    expect(parsePlanMarkdown('')).toEqual({ title: 'Plan', body: '' });
  });
});
