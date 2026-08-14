# Project Context Panel

Notes, todos, and saved plans for the active project. Rendered by the `notes`
surface in the desktop context rail and by the mobile workspace drawer.

## Files

| File | Owns |
|---|---|
| `ProjectNotesTodoPanel.tsx` | container: store subscription, load, failure toast, tabs, search query, the todo write |
| `NotesSection.tsx` | note composer, note list, per-note edit/pin/delete |
| `TodosSection.tsx` | todo list, add/toggle/delete/clear, drag reorder, list resize |
| `PlansSection.tsx` | plan list, import, pin, delete, open |
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

## Where writes live

Notes, todos, and plans each have their own routes, so each section owns its
writes end to end and no section has to persist a neighbour's state alongside
its own. `NotesSection` and `PlansSection` call the store directly. Todos still
route through the container only because the container already holds the list it
sorts for display.

An earlier version wrote notes and todos together in one request. That forced
the container to own the notes draft, because otherwise a todo toggle would
persist whatever notes were last committed and discard unsaved typing. Splitting
the routes removed the coupling rather than managing it.

## Layout

The three lists are tabs, not one stacked column. Stacking gave each list its
own scroller inside the panel's scroller, and it only got worse as lists grew —
the todo list had to carry a manual resize handle just to stay usable. With
tabs there is exactly one scroller: the panel's. The resize handle and its
persisted `todoPanelHeight` are gone with it, and each section renders its list
at natural height.

The host (`RightSidebarTabs`) therefore sets `overflow-hidden`; putting a
scroller there again would nest one inside the other.

Section headers no longer repeat their own name or count — the tab carries both.

The active tab persists in `useUIStore` so switching surfaces or remounting the
panel returns to where the user was.

## Search

One query in the container filters all three tabs, and the tab bar doubles as
the result summary: each tab shows its match count. Tabs divide, and search is
the one thing division would hurt — you do not always remember whether
something was written as a note or lives in a plan — so search deliberately
stays above the tabs rather than becoming per-tab.

If the active tab has no matches and another does, the panel follows the search
there. Without that, typing a query whose hits live elsewhere shows an empty
list and the user has to guess which tab to try.

Filtering is display-only: every mutation still acts on the full list, so
reordering or clearing completed todos while a filter is active cannot drop
hidden items. The query resets when the project changes, since a query that
matched the old project would silently hide everything in the new one.

## Invariants

- **Each note row keeps a local, debounced draft.** Writing on every keystroke
  would put a request behind every character, and re-reading the store each
  render would fight the caret.
- **An external note change is adopted only while that row is untouched** since
  its last save. "Add to notes" from a chat selection must reach an open panel,
  but must never overwrite what the user is typing.
- **Only one note is expanded at a time, and collapsed notes are clamped.**
  Notes run to 3000 characters each; with the panel owning the only scroller,
  unbounded rows turn the tab into one unbroken wall of text. A collapsed note
  shows a three-line preview and expands into its editor on click.
- **A blanked note body is never persisted.** The server rejects it, so the row
  restores its last saved text on blur rather than showing a phantom failure.
  Deleting is an explicit action.
- **A load failure never blanks the panel.** The store keeps the last good
  snapshot; the panel toasts once, and only when nothing had loaded yet.
- **Completed todos sink to the bottom for display only.** Stored order is what
  the user dragged.
- **Plan creation is not optimistic.** The id and file name come from the
  server, and a row that cannot be opened is worse than a brief wait.

## Pinned context

The pin toggle on a note or plan marks it as standing context for the agent.
Assembly and delivery live in `packages/ui/src/lib/projectContextPinning.ts`;
this surface only owns the toggle. `ComposerPinnedContextChip` shows the user
what is riding along.

## Related

- Store: `packages/ui/src/stores/useProjectContextStore.ts`
- HTTP client: `packages/ui/src/lib/projectContextApi.ts`
- Plan viewer/editor: `packages/ui/src/components/views/PlanView.tsx`
- User docs: `packages/docs/content/docs/notes-todos-plans.mdx`
