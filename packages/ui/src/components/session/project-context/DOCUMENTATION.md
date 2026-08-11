# Project Context Panel

Notes, todos, and saved plans for the active project. Rendered by the `notes`
surface in the desktop context rail and by the mobile workspace drawer.

## Files

| File | Owns |
|---|---|
| `ProjectNotesTodoPanel.tsx` | container: store subscription, load, failure toast, the shared notes/todos write |
| `NotesSection.tsx` | notes header, character counter, textarea (presentational) |
| `TodosSection.tsx` | todo list, add/toggle/delete/clear, drag reorder, list resize |
| `PlansSection.tsx` | plan list, import, delete, open |
| `useProjectNotesDraft.ts` | notes draft, hydration, debounced save |
| `useProjectTodoSend.ts` | sending a todo to a current/new/worktree session |

## Data flow

Storage is server-owned; see
`packages/web/server/lib/project-context/DOCUMENTATION.md`. The panel never
touches `/api/fs/*` and never handles a plan path — plans are addressed by id.

```
useProjectContextStore  ->  ProjectNotesTodoPanel  ->  sections
      (server cache)          (load + shared write)
```

There is deliberately no cross-panel event. An earlier version broadcast
`openchamber:project-notes-updated` / `openchamber:project-plan-saved` on the
window and every mounted panel re-read the whole config in response. Writers now
mutate the store and readers re-render from it.

## Why the container owns the notes draft

`saveNotesAndTodos` writes both fields at once, so a todo mutation has to
persist the current notes alongside it. If `NotesSection` owned the draft, todo
writes would save whatever notes were last committed and silently discard
unsaved typing. The container therefore holds the draft (via
`useProjectNotesDraft`) and hands `TodosSection` an `onPersistTodos` callback
that already closes over it. `TodosSection` never learns that notes exist.

Plan mutations touch neither field, so `PlansSection` calls the store directly.

## Invariants

- **The draft is seeded once per project, not synced every render.** Re-reading
  the store on each render would fight the debounced write and reset the caret.
- **An external notes change is adopted only while the editor is untouched**
  since its last save. "Add to notes" from a chat selection must reach an open
  panel, but must never overwrite what the user is typing.
- **A load failure never blanks the panel.** The store keeps the last good
  snapshot; the panel toasts once, and only when nothing had loaded yet.
- **Completed todos sink to the bottom for display only.** Stored order is what
  the user dragged.
- **Plan creation is not optimistic.** The id and file name come from the
  server, and a row that cannot be opened is worse than a brief wait.

## Related

- Store: `packages/ui/src/stores/useProjectContextStore.ts`
- HTTP client: `packages/ui/src/lib/projectContextApi.ts`
- Plan viewer/editor: `packages/ui/src/components/views/PlanView.tsx`
- User docs: `packages/docs/content/docs/notes-todos-plans.mdx`
