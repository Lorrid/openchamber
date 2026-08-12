import type { ProjectRef } from '@/lib/worktrees/worktreeManager';

type WorktreeRef = { path: string; branch?: string; label?: string };

/**
 * Best-effort mirror of worktree lifecycle events into the messenger bridge
 * (Discord threads under the project channel).
 *
 * The messenger store is imported lazily so the worktree hot path never pays
 * for it, and every helper no-ops unless Discord worktree sync is configured.
 */

const labelForPath = (path: string): string => path.split('/').pop() ?? path;

export function notifyWorktreeAddedToMessenger(
  project: ProjectRef,
  worktree: WorktreeRef,
  sessionId?: string | null,
): void {
  void import('@/stores/useMessengerStore')
    .then(({ useMessengerStore }) => {
      void useMessengerStore.getState().notifyWorktreeAdded(
        { id: project.id, path: project.path, label: labelForPath(project.path) },
        worktree,
        sessionId,
      );
    })
    .catch(() => undefined);
}

export function notifyWorktreeRemovedToMessenger(project: ProjectRef, worktree: WorktreeRef): void {
  void import('@/stores/useMessengerStore')
    .then(({ useMessengerStore }) => {
      void useMessengerStore.getState().notifyWorktreeRemoved(
        { id: project.id, path: project.path, label: labelForPath(project.path) },
        worktree,
      );
    })
    .catch(() => undefined);
}
