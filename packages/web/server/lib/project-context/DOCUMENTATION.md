# Project Context

Server-owned storage for the Project Notes surface: free-form notes, todos, and
plan markdown files.

## Ownership

| Path | Owner | Contents |
|---|---|---|
| `<projectsDir>/<projectId>.json` | shared UI (`packages/ui/src/lib/openchamberConfig.ts`), plus server-owned `version` / `scheduledTasks` | worktree setup, draft starters, project actions |
| `<projectsDir>/<projectId>/context.json` | **this module, exclusively** | notes, todos, plan manifest |
| `<projectsDir>/<projectId>/plans/*.md` | **this module, exclusively** | plan bodies |

The split is the point. Both files were previously one, written by the client
with a whole-file read-modify-write. Adding a server writer to that file would
have made unrelated features (project actions, draft starters) clobber notes
across processes, with no lock able to span both sides. Separate files remove
the shared resource instead of trying to coordinate access to it.

Nothing outside this module may write `context.json` or the `plans` directory.

## Storage format

```json
{
  "version": 1,
  "notes": "",
  "todos": [{ "id": "", "text": "", "completed": false, "createdAt": 0 }],
  "plans": [{ "id": "", "file": "1700000000-title.md", "title": "", "createdAt": 0 }]
}
```

Plan links store a **base name**, never a path. The file always lives in
`<projectId>/plans/`, so moving the project storage directory cannot invalidate
a reference and a caller can never address a file outside it. `title` is
denormalized into the manifest so listing plans costs one read rather than one
read per plan; `readPlan` returns the title parsed from the file, which wins if
the two ever disagree.

## Routes

| Method | Route | Notes |
|---|---|---|
| GET | `/api/project-context/:projectId` | full context; missing file is `200` empty |
| PUT | `/api/project-context/:projectId/notes-todos` | replaces both; returns committed context |
| GET | `/api/project-context/:projectId/plans/:planId` | `404` when the link or its markdown is gone |
| POST | `/api/project-context/:projectId/plans` | `201`; takes `{title, body}`, never a path |
| DELETE | `/api/project-context/:projectId/plans/:planId` | `404` when unknown |

`projectId` is validated against `/^[a-zA-Z0-9._:-]+$/`, which rejects
separators and traversal. Validation failures are `400`; malformed stored data
and I/O failures are `500`.

## Invariants

- **Missing is not malformed.** A missing `context.json` is authoritative empty
  data. Unparseable JSON is a failure that propagates as `500`, so the client
  preserves what it already has instead of rendering an empty panel over intact
  data on disk.
- **Writes are serialized per project** through an in-process lock, and land via
  write-to-temp + rename so a crash cannot leave a half-written file.
- **`readContext` never takes the lock.** Every mutator calls it while already
  holding the lock, so locking there would deadlock. The legacy migration it can
  trigger is safe unlocked: both writes are atomic renames of identical content.
- **Plan create writes markdown before the manifest entry**; delete removes the
  manifest entry before the file. Either partial failure leaves an unreferenced
  markdown file, which is inert. The reverse order would leave a manifest entry
  that renders as a plan and fails to open.
- **Per-entry sanitization never fails the whole read.** A malformed todo or
  plan link is dropped; the rest of the context still loads.

## Legacy migration

`projectNotes`, `projectTodos`, and `projectPlanFiles` originally lived in
`<projectId>.json`. On the first read with no `context.json`, those three keys
are moved out and deleted from the client-owned file; every other key is
preserved untouched.

Plan links carried absolute paths. Migration converts each to a base name. A
file already in the plans directory is used in place; one referenced from
elsewhere — a stale path left by an earlier project id — is copied in rather
than dropped. A link whose markdown cannot be found at all is discarded, since
it could not have been opened either way.

The legacy keys are removed only after `context.json` is durably written, so any
failure simply leaves the migration to run again on the next read. Repeat and
concurrent reads converge on identical content.

## Cross-module contract

`packages/web/server/lib/opencode/settings-runtime.js` merges project storage
when a project id changes. Its `mergeProjectContextFiles` step must run before
`moveDirectoryContents`, because that mover only renames into a free
destination and would otherwise discard the old `context.json` whenever the
destination already had one.

`mergeProjectConfigData` still merges the legacy `projectNotes` /
`projectTodos` / `projectPlanFiles` keys. That is deliberate: a project whose
context has not been migrated yet keeps its data in `<projectId>.json`, and the
migration picks it up from the merged destination afterwards.

## Tests

- `runtime.test.js` — storage, sanitization, migration, locking, plan lifecycle.
- `routes.test.js` — status-code mapping, payload validation, failure surfacing.
