/**
 * Agent memory storage.
 *
 * What the agent has learned and chose to keep, in two scopes:
 *
 * - **project** — `<projectsDir>/<projectId>/memory.json`. How this codebase
 *   works, what was decided, where things live.
 * - **global** — `<userConfigRoot>/memory.json`. Who the user is and how they
 *   want to be worked with. It belongs to no project, so it cannot live under
 *   one.
 *
 * The split is not cosmetic. A wrong project fact costs one project and is
 * noticed quickly; a wrong global fact quietly shapes every session in every
 * project, and the user has no code to check it against. Global memory is
 * therefore deliberately narrower: fewer entries, and only the types that
 * genuinely have no other home.
 *
 * This is NOT the notes surface. Notes are what the user writes for themselves
 * and hands to the agent by pinning; memory is what the agent writes for
 * itself. Keeping them apart keeps an agent mistake out of the user's notes.
 */

const MEMORY_VERSION = 1;

const MEMORY_TITLE_MAX_LENGTH = 120;
const MEMORY_BODY_MAX_LENGTH = 2000;

/** Global memory stays small on purpose: it is the highest-blast-radius store. */
const GLOBAL_MEMORY_MAX_ITEMS = 60;
const PROJECT_MEMORY_MAX_ITEMS = 200;

/**
 * `fact` — something true about the project or the user.
 * `preference` — how the user wants work done.
 * `reference` — a pointer to a resource that is hard to rediscover.
 */
const MEMORY_TYPES = new Set(['fact', 'preference', 'reference']);

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/;

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const clampLength = (value, maxLength) => {
  if (typeof value !== 'string') return '';
  return value.length > maxLength ? value.slice(0, maxLength) : value;
};

const isObjectRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const limitForScope = (scope) => (scope === 'global' ? GLOBAL_MEMORY_MAX_ITEMS : PROJECT_MEMORY_MAX_ITEMS);

const sanitizeEntries = (value, now, scope) => {
  if (!Array.isArray(value)) return [];

  const result = [];
  const seen = new Set();
  for (const entry of value) {
    if (result.length >= limitForScope(scope)) break;
    if (!isObjectRecord(entry)) continue;

    const id = asNonEmptyString(entry.id);
    const title = clampLength(asNonEmptyString(entry.title) || '', MEMORY_TITLE_MAX_LENGTH);
    const body = clampLength(typeof entry.body === 'string' ? entry.body : '', MEMORY_BODY_MAX_LENGTH).trim();
    if (!id || !title || !body || seen.has(id)) continue;
    seen.add(id);

    const createdAt = Number.isFinite(entry.createdAt) && entry.createdAt >= 0 ? entry.createdAt : now;
    const sessionId = asNonEmptyString(entry.sessionId);
    result.push({
      id,
      title,
      body,
      type: MEMORY_TYPES.has(entry.type) ? entry.type : 'fact',
      createdAt,
      updatedAt: Number.isFinite(entry.updatedAt) && entry.updatedAt >= 0 ? entry.updatedAt : createdAt,
      ...(sessionId ? { sessionId } : {}),
    });
  }

  return result.sort((a, b) => b.updatedAt - a.updatedAt);
};

const createEmptyMemory = () => ({ version: MEMORY_VERSION, entries: [] });

/**
 * The index the agent sees at the start of a session: titles only, never
 * bodies. Bodies are fetched on demand, because an index that carries them
 * grows without bound until it crowds out the conversation itself.
 */
export const formatMemoryIndex = ({ globalEntries, projectEntries }) => {
  const sections = [];

  const render = (entries) => entries
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((entry) => `- [${entry.type}] ${entry.title}`)
    .join('\n');

  if (globalEntries.length > 0) {
    sections.push(`### About the user\n\n${render(globalEntries)}`);
  }
  if (projectEntries.length > 0) {
    sections.push(`### About this project\n\n${render(projectEntries)}`);
  }
  if (sections.length === 0) {
    return '';
  }

  return [
    'You have stored memory from earlier sessions. Only the titles are listed;'
      + ' read an entry with the openchamber_memory tool when it is relevant.',
    'Memory records what was true when it was written. Verify anything it says'
      + ' about files, flags or commands before relying on it.',
    ...sections,
  ].join('\n\n');
};

export const createAgentMemoryRuntime = (deps) => {
  const { fsPromises, path, projectsDirPath, userConfigRoot, createId } = deps;

  const idFactory = typeof createId === 'function'
    ? createId
    : () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

  const writeLocks = new Map();

  const sanitizeProjectId = (projectId) => {
    const value = asNonEmptyString(projectId);
    if (!value) {
      throw new Error('projectId is required');
    }
    if (!PROJECT_ID_PATTERN.test(value)) {
      throw new Error('projectId contains unsupported characters');
    }
    return value;
  };

  /** `target` is `{ scope: 'global' }` or `{ scope: 'project', projectId }`. */
  const resolveTarget = (target) => {
    if (target?.scope === 'global') {
      return { scope: 'global', key: 'global', filePath: path.join(userConfigRoot, 'memory.json') };
    }
    if (target?.scope === 'project') {
      const projectId = sanitizeProjectId(target.projectId);
      return {
        scope: 'project',
        key: `project:${projectId}`,
        filePath: path.join(projectsDirPath, projectId, 'memory.json'),
      };
    }
    throw new Error('scope is required');
  };

  const readJson = async (filePath) => {
    let raw;
    try {
      raw = await fsPromises.readFile(filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return { missing: true, value: null };
      throw error;
    }
    try {
      const parsed = JSON.parse(raw);
      return { missing: false, value: isObjectRecord(parsed) ? parsed : null };
    } catch {
      return { missing: false, value: null };
    }
  };

  const writeJsonAtomic = async (filePath, value) => {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await fsPromises.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    await fsPromises.rename(temporaryPath, filePath);
  };

  const withWriteLock = async (key, mutate) => {
    const previous = writeLocks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    const chained = previous.finally(() => next);
    writeLocks.set(key, chained);

    await previous;
    try {
      return await mutate();
    } finally {
      release();
      if (writeLocks.get(key) === chained) {
        writeLocks.delete(key);
      }
    }
  };

  /**
   * Missing is authoritative empty; malformed is a failure. An agent that reads
   * "no memory" from a corrupt file would cheerfully rewrite everything it
   * thought it had lost.
   */
  const read = async (target) => {
    const resolved = resolveTarget(target);
    const stored = await readJson(resolved.filePath);

    if (!stored.missing && !stored.value) {
      throw new Error('Stored agent memory is malformed');
    }
    if (stored.missing) {
      return createEmptyMemory();
    }

    return {
      version: MEMORY_VERSION,
      entries: sanitizeEntries(stored.value.entries, Date.now(), resolved.scope),
    };
  };

  const write = async (resolved, entries) => {
    await writeJsonAtomic(resolved.filePath, { version: MEMORY_VERSION, entries });
  };

  const create = async (target, value) => {
    const resolved = resolveTarget(target);
    const title = clampLength(asNonEmptyString(value?.title) || '', MEMORY_TITLE_MAX_LENGTH);
    const body = clampLength(typeof value?.body === 'string' ? value.body : '', MEMORY_BODY_MAX_LENGTH).trim();
    if (!title) throw new Error('title is required');
    if (!body) throw new Error('body is required');

    return withWriteLock(resolved.key, async () => {
      const now = Date.now();
      const current = await read(target);
      const limit = limitForScope(resolved.scope);
      if (current.entries.length >= limit) {
        throw new Error(`${resolved.scope} memory holds at most ${limit} entries`);
      }

      // Same title in the same scope is an update, not a second copy: an agent
      // re-learning a fact each session would otherwise fill the store with
      // near-duplicates and contradict itself.
      const existing = current.entries.find(
        (entry) => entry.title.toLowerCase() === title.toLowerCase(),
      );
      if (existing) {
        const updated = { ...existing, body, updatedAt: now, ...(MEMORY_TYPES.has(value?.type) ? { type: value.type } : {}) };
        const entries = current.entries.map((entry) => (entry.id === existing.id ? updated : entry));
        await write(resolved, entries);
        return { entry: updated, entries, replaced: true };
      }

      const sessionId = asNonEmptyString(value?.sessionId);
      const entry = {
        id: idFactory(),
        title,
        body,
        type: MEMORY_TYPES.has(value?.type) ? value.type : 'fact',
        createdAt: now,
        updatedAt: now,
        ...(sessionId ? { sessionId } : {}),
      };
      const entries = [entry, ...current.entries];
      await write(resolved, entries);
      return { entry, entries, replaced: false };
    });
  };

  const update = async (target, memoryId, patch) => {
    const resolved = resolveTarget(target);
    const id = asNonEmptyString(memoryId);
    if (!id) throw new Error('memoryId is required');

    const hasTitle = typeof patch?.title === 'string';
    const hasBody = typeof patch?.body === 'string';
    const hasType = MEMORY_TYPES.has(patch?.type);
    if (!hasTitle && !hasBody && !hasType) {
      throw new Error('title, body or type is required');
    }
    const title = hasTitle ? clampLength(patch.title, MEMORY_TITLE_MAX_LENGTH).trim() : null;
    const body = hasBody ? clampLength(patch.body, MEMORY_BODY_MAX_LENGTH).trim() : null;
    if (hasTitle && !title) throw new Error('title is required');
    if (hasBody && !body) throw new Error('body is required');

    return withWriteLock(resolved.key, async () => {
      const current = await read(target);
      const existing = current.entries.find((entry) => entry.id === id);
      if (!existing) {
        return null;
      }

      const updated = {
        ...existing,
        ...(hasTitle ? { title } : {}),
        ...(hasBody ? { body } : {}),
        ...(hasType ? { type: patch.type } : {}),
        updatedAt: Date.now(),
      };
      const entries = current.entries.map((entry) => (entry.id === id ? updated : entry));
      await write(resolved, entries);
      return { entry: updated, entries };
    });
  };

  const remove = async (target, memoryId) => {
    const resolved = resolveTarget(target);
    const id = asNonEmptyString(memoryId);
    if (!id) throw new Error('memoryId is required');

    return withWriteLock(resolved.key, async () => {
      const current = await read(target);
      if (!current.entries.some((entry) => entry.id === id)) {
        return { deleted: false, entries: current.entries };
      }
      const entries = current.entries.filter((entry) => entry.id !== id);
      await write(resolved, entries);
      return { deleted: true, entries };
    });
  };

  /**
   * Both scopes at once, for the session index. A failure in one scope must not
   * hide the other: losing the project half should not also erase what the
   * agent knows about the user.
   */
  const readAll = async (projectId) => {
    const settled = await Promise.allSettled([
      read({ scope: 'global' }),
      projectId ? read({ scope: 'project', projectId }) : Promise.resolve(createEmptyMemory()),
    ]);

    return {
      global: settled[0].status === 'fulfilled' ? settled[0].value.entries : [],
      project: settled[1].status === 'fulfilled' ? settled[1].value.entries : [],
      globalFailed: settled[0].status === 'rejected',
      projectFailed: settled[1].status === 'rejected',
    };
  };

  return { read, readAll, create, update, remove, resolveTarget };
};
