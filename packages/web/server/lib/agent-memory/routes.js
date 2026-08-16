/**
 * OpenChamber agent memory routes.
 *
 * The scope is a query parameter rather than part of the path, because global
 * and project memory are the same resource with two homes: one set of handlers
 * that resolve `?scope=global` or `?scope=project&projectId=...`. Getting the
 * scope wrong must fail loudly, never silently write the user's global memory
 * from a project-scoped call.
 *
 * These routes read and delete only. Memory is written by the agent through the
 * `openchamber_memory` tool, not from the panel, so there is no create route to
 * keep in step — and none of these carry a request body, which is why no JSON
 * parser is attached. Adding a body-carrying route here means attaching
 * `express.json()` to it: there is no global parser, because the generic
 * OpenCode proxy needs an unread request stream.
 */

const isValidationError = (error) => {
  const message = error instanceof Error ? error.message : '';
  return message.includes('is required')
    || message.includes('unsupported characters')
    || message.includes('holds at most');
};

const respondWithError = (res, error, fallbackMessage) => {
  const message = error instanceof Error ? error.message : fallbackMessage;
  if (isValidationError(error)) {
    return res.status(400).json({ error: message });
  }
  return res.status(500).json({ error: message || fallbackMessage });
};

/**
 * Resolves the target scope, or returns the reason it could not be resolved.
 * A project request without an id is rejected here rather than quietly falling
 * back to global, which would write project facts into every other project.
 */
const resolveScope = (query) => {
  if (query.scope === 'global') {
    return { target: { scope: 'global' } };
  }
  if (query.scope === 'project') {
    if (typeof query.projectId !== 'string' || query.projectId.trim().length === 0) {
      return { error: 'projectId is required for project scope' };
    }
    return { target: { scope: 'project', projectId: query.projectId } };
  }
  return { error: 'scope must be global or project' };
};

export const registerAgentMemoryRoutes = (app, dependencies) => {
  const { agentMemoryRuntime, isAgentMemoryEnabled } = dependencies;

  /**
   * One gate for the whole surface. The settings toggle disables the feature,
   * not just its UI: with memory off, these routes must not read or write the
   * store at all, or a stale client would keep editing memory the user believes
   * is turned off.
   */
  const requireEnabled = async (_req, res, next) => {
    if (!isAgentMemoryEnabled) {
      return next();
    }
    try {
      // Awaited: the setting is read from disk, and testing the returned
      // promise for truthiness would leave the gate permanently open.
      if (!(await isAgentMemoryEnabled())) {
        // Flagged, not merely 404: a missing entry answers 404 too, and a
        // client that could not tell them apart would report a deleted memory
        // as the whole feature being switched off.
        return res.status(404).json({ error: 'Agent memory is disabled', disabled: true });
      }
    } catch {
      // An unreadable settings file must not silently expose a surface the
      // user may have turned off.
      return res.status(503).json({ error: 'Agent memory availability is unknown' });
    }
    return next();
  };

  app.get('/api/agent-memory', requireEnabled, async (req, res) => {
    const { target, error } = resolveScope(req.query);
    if (error) {
      return res.status(400).json({ error });
    }
    try {
      return res.json(await agentMemoryRuntime.read(target));
    } catch (caught) {
      return respondWithError(res, caught, 'Failed to read agent memory');
    }
  });

  /**
   * Both scopes in one response. The panel always shows them together, and two
   * separate requests would let one scope render while the other is still
   * loading, which reads as memory that has gone missing.
   */
  app.get('/api/agent-memory/all', requireEnabled, async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId.trim().length > 0
      ? req.query.projectId
      : null;
    try {
      return res.json(await agentMemoryRuntime.readAll(projectId));
    } catch (caught) {
      return respondWithError(res, caught, 'Failed to read agent memory');
    }
  });

  app.delete('/api/agent-memory/:memoryId', requireEnabled, async (req, res) => {
    const { target, error } = resolveScope(req.query);
    if (error) {
      return res.status(400).json({ error });
    }

    try {
      const result = await agentMemoryRuntime.remove(target, req.params.memoryId);
      if (!result.deleted) {
        return res.status(404).json({ error: 'Memory not found' });
      }
      return res.json(result);
    } catch (caught) {
      return respondWithError(res, caught, 'Failed to delete memory');
    }
  });
};
