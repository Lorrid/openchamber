/**
 * Dispatch for the `memory.*` actions the `openchamber_memory` tool calls.
 *
 * Kept beside the store rather than inside the control service, because the
 * control service already owns sessions, schedules and the browser; memory
 * shares none of that machinery and only needs the same envelope.
 *
 * Project scope is derived from the session's directory, never from the model.
 * Letting the agent name a project id would let a memory learned in one
 * checkout be filed against another, which the user would have no way to
 * notice.
 */

import { createProjectIdFromPath } from '../projects/project-id.js';

const MEMORY_TYPES = new Set(['fact', 'preference', 'reference']);

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Everything the agent is told about an entry it has not opened yet. */
const toSummary = (entry, scope) => ({
  memoryId: entry.id,
  title: entry.title,
  type: entry.type,
  scope,
  reviewed: entry.reviewed,
});

const toFullEntry = (entry, scope) => ({ ...toSummary(entry, scope), body: entry.body });

export const createAgentMemoryActions = (dependencies) => {
  const { agentMemoryRuntime, createError } = dependencies;

  const fail = (message, status = 400) => {
    throw createError(message, status);
  };

  const resolveProjectId = (contextDirectory) => {
    const directory = asNonEmptyString(contextDirectory);
    const projectId = directory ? createProjectIdFromPath(directory) : '';
    if (!projectId) {
      fail('Project memory needs a session directory, and this session has none', 400);
    }
    return projectId;
  };

  const resolveTarget = (input, contextDirectory) => {
    const scope = asNonEmptyString(input.scope);
    if (scope === 'global') return { scope: 'global' };
    if (scope === 'project') {
      return { scope: 'project', projectId: resolveProjectId(contextDirectory) };
    }
    return fail('scope must be global or project', 400);
  };

  const listBothScopes = async (contextDirectory) => {
    const directory = asNonEmptyString(contextDirectory);
    const projectId = directory ? createProjectIdFromPath(directory) : null;
    const result = await agentMemoryRuntime.readAll(projectId);

    // A scope that failed to load is reported, never rendered as empty: an
    // agent told it has no memories will happily store them all again.
    return {
      memories: [
        ...result.global.map((entry) => toSummary(entry, 'global')),
        ...result.project.map((entry) => toSummary(entry, 'project')),
      ],
      ...(result.globalFailed ? { globalUnavailable: true } : {}),
      ...(result.projectFailed ? { projectUnavailable: true } : {}),
    };
  };

  const list = async (input, contextDirectory) => {
    const scope = asNonEmptyString(input.scope);
    if (!scope || scope === 'both') {
      return listBothScopes(contextDirectory);
    }
    const target = resolveTarget(input, contextDirectory);
    const { entries } = await agentMemoryRuntime.read(target);
    return { memories: entries.map((entry) => toSummary(entry, target.scope)) };
  };

  /**
   * Reading by title as well as by id is deliberate: the session index lists
   * titles only, so requiring an id would force a list call before every read
   * just to translate what the agent can already see.
   */
  const read = async (input, contextDirectory) => {
    const target = resolveTarget(input, contextDirectory);
    const memoryId = asNonEmptyString(input.memoryId);
    const title = asNonEmptyString(input.title);
    if (!memoryId && !title) {
      fail('memory.read requires memoryId or title', 400);
    }

    const { entries } = await agentMemoryRuntime.read(target);
    const found = memoryId
      ? entries.find((entry) => entry.id === memoryId)
      : entries.find((entry) => entry.title.toLowerCase() === title.toLowerCase());
    if (!found) {
      fail('No memory matches that id or title in this scope', 404);
    }
    return { memory: toFullEntry(found, target.scope) };
  };

  const save = async (input, contextDirectory) => {
    const target = resolveTarget(input, contextDirectory);
    const title = asNonEmptyString(input.title);
    const body = asNonEmptyString(input.body);
    if (!title) fail('title is required for memory.save', 400);
    if (!body) fail('body is required for memory.save', 400);
    if (input.type !== undefined && !MEMORY_TYPES.has(input.type)) {
      fail('type must be fact, preference, or reference', 400);
    }

    const result = await agentMemoryRuntime.create(target, {
      title,
      body,
      type: input.type,
      sessionId: asNonEmptyString(input.sessionId),
    });
    return {
      memory: toFullEntry(result.entry, target.scope),
      // Told plainly so the agent does not report storing a second memory when
      // it actually corrected one it had already written.
      replaced: result.replaced,
    };
  };

  const remove = async (input, contextDirectory) => {
    const target = resolveTarget(input, contextDirectory);
    const memoryId = asNonEmptyString(input.memoryId);
    if (!memoryId) fail('memoryId is required for memory.delete', 400);

    const result = await agentMemoryRuntime.remove(target, memoryId);
    if (!result.deleted) {
      fail('No memory has that id in this scope', 404);
    }
    return { deleted: true, memoryId };
  };

  const execute = async (action, input = {}, contextDirectory) => {
    switch (action) {
      case 'memory.list': return list(input, contextDirectory);
      case 'memory.read': return read(input, contextDirectory);
      case 'memory.save': return save(input, contextDirectory);
      case 'memory.delete': return remove(input, contextDirectory);
      default: return fail(`Unsupported memory action: ${action || 'missing'}`, 400);
    }
  };

  return { execute };
};
