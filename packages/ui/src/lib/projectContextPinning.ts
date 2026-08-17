/**
 * Which project context is pinned, for the surfaces that count or list it.
 *
 * Assembling the block and deciding when a session needs it belong to the
 * server (`packages/web/server/lib/session-knowledge`). They lived here once,
 * which left sessions started without a UI with no context at all and let a
 * tab keep believing the agent still had context compaction had removed.
 */

import type { ProjectNote, ProjectPlanLink } from './projectContextApi';

interface PinnedContextSelection {
  notes: ProjectNote[];
  plans: ProjectPlanLink[];
}

export const selectPinnedItems = (
  context: { notes: ProjectNote[]; plans: ProjectPlanLink[] },
): PinnedContextSelection => ({
  notes: context.notes.filter((note) => note.pinned),
  plans: context.plans.filter((plan) => plan.pinned),
});

export const countPinnedItems = (selection: PinnedContextSelection): number => (
  selection.notes.length + selection.plans.length
);

