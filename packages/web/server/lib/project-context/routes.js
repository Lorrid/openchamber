/**
 * OpenChamber project context routes: notes, todos, and plan files.
 *
 * These replace the shared UI's direct `/api/fs/*` access to
 * `~/.config/openchamber/projects/*`. The client no longer resolves the home
 * directory or composes storage paths, and plan markdown is addressed by id
 * rather than by an absolute path supplied by the caller.
 */

const isObjectRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isValidationError = (error) => {
  const message = error instanceof Error ? error.message : '';
  return message.includes('is required') || message.includes('unsupported characters');
};

const respondWithError = (res, error, fallbackMessage) => {
  const message = error instanceof Error ? error.message : fallbackMessage;
  if (isValidationError(error)) {
    return res.status(400).json({ error: message });
  }
  return res.status(500).json({ error: message || fallbackMessage });
};

const hasValidTodosShape = (value) => (
  Array.isArray(value)
  && value.every((todo) => (
    isObjectRecord(todo)
    && typeof todo.id === 'string'
    && typeof todo.text === 'string'
    && (todo.completed === undefined || typeof todo.completed === 'boolean')
    && (todo.createdAt === undefined || (typeof todo.createdAt === 'number' && Number.isFinite(todo.createdAt)))
  ))
);

export const registerProjectContextRoutes = (app, dependencies) => {
  const { projectContextRuntime } = dependencies;

  app.get('/api/project-context/:projectId', async (req, res) => {
    try {
      return res.json(await projectContextRuntime.readContext(req.params.projectId));
    } catch (error) {
      return respondWithError(res, error, 'Failed to read project context');
    }
  });

  app.put('/api/project-context/:projectId/notes-todos', async (req, res) => {
    const body = req.body;
    if (!isObjectRecord(body)) {
      return res.status(400).json({ error: 'Body must be an object' });
    }
    if (body.notes !== undefined && typeof body.notes !== 'string') {
      return res.status(400).json({ error: 'notes must be a string' });
    }
    if (body.todos !== undefined && !hasValidTodosShape(body.todos)) {
      return res.status(400).json({ error: 'todos must be an array of todo items' });
    }

    try {
      const context = await projectContextRuntime.saveNotesAndTodos(req.params.projectId, {
        notes: body.notes ?? '',
        todos: body.todos ?? [],
      });
      return res.json(context);
    } catch (error) {
      return respondWithError(res, error, 'Failed to save project notes and todos');
    }
  });

  app.get('/api/project-context/:projectId/plans/:planId', async (req, res) => {
    try {
      const plan = await projectContextRuntime.readPlan(req.params.projectId, req.params.planId);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      return res.json(plan);
    } catch (error) {
      return respondWithError(res, error, 'Failed to read plan');
    }
  });

  app.put('/api/project-context/:projectId/plans/:planId', async (req, res) => {
    const body = req.body;
    if (!isObjectRecord(body)) {
      return res.status(400).json({ error: 'Body must be an object' });
    }
    if (typeof body.raw !== 'string') {
      return res.status(400).json({ error: 'raw must be a string' });
    }

    try {
      const result = await projectContextRuntime.updatePlan(
        req.params.projectId,
        req.params.planId,
        { raw: body.raw },
      );
      if (!result) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      return res.json(result);
    } catch (error) {
      return respondWithError(res, error, 'Failed to save plan');
    }
  });

  app.post('/api/project-context/:projectId/plans', async (req, res) => {
    const body = req.body;
    if (!isObjectRecord(body)) {
      return res.status(400).json({ error: 'Body must be an object' });
    }
    if (typeof body.body !== 'string') {
      return res.status(400).json({ error: 'body must be a string' });
    }
    if (body.title !== undefined && typeof body.title !== 'string') {
      return res.status(400).json({ error: 'title must be a string' });
    }

    try {
      const { plan, context } = await projectContextRuntime.createPlan(req.params.projectId, {
        title: body.title ?? '',
        body: body.body,
      });
      return res.status(201).json({ plan, context });
    } catch (error) {
      return respondWithError(res, error, 'Failed to create plan');
    }
  });

  app.delete('/api/project-context/:projectId/plans/:planId', async (req, res) => {
    try {
      const { deleted, context } = await projectContextRuntime.deletePlan(
        req.params.projectId,
        req.params.planId,
      );
      if (!deleted) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      return res.json(context);
    } catch (error) {
      return respondWithError(res, error, 'Failed to delete plan');
    }
  });
};
