import { useEffect } from 'react';
import { useMessengerStore } from '@/stores/useMessengerStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import type { ProjectEntry } from '@/lib/api/types';

/**
 * Keep Discord channels and Telegram forum topics in lockstep with the
 * OpenChamber project list.
 *
 * When a project is added, renamed, or removed in the UI, this mirrors the
 * change to every sync-enabled Discord server and Telegram chat (create /
 * rename / delete the project's channel or topic) so web conversations land
 * in a per-project surface instead of dumping into a default channel/chat.
 * The work is delegated to the messenger store, which no-ops per platform
 * unless that platform is configured and has at least one server/chat with
 * project sync enabled — so a project added while ONLY Telegram sync is on
 * still gets its Telegram topic, not just at the next manual "Sync now".
 *
 * Implemented as a store subscription (rather than calling into the messenger
 * store from `useProjectsStore`) so the projects store stays free of messenger
 * coupling and we react to every code path that mutates the project list.
 */
export function useMessengerProjectChannelSync() {
  useEffect(() => {
    const reconcile = (next: ProjectEntry[], prev: ProjectEntry[]) => {
      if (next === prev) return;
      const messenger = useMessengerStore.getState();
      // ensureProjectChannel/renameProjectChannel/removeProjectChannel each
      // no-op internally when neither platform has project sync configured,
      // so no store-level gate is needed here.

      const prevById = new Map(prev.map((p) => [p.id, p]));
      const nextById = new Map(next.map((p) => [p.id, p]));

      for (const project of next) {
        const before = prevById.get(project.id);
        if (!before) {
          void messenger.ensureProjectChannel(project);
        } else if ((before.label ?? '') !== (project.label ?? '')) {
          void messenger.renameProjectChannel(project);
        }
      }
      for (const project of prev) {
        if (!nextById.has(project.id)) {
          void messenger.removeProjectChannel(project.id, project.path);
        }
      }
    };

    return useProjectsStore.subscribe((state, prevState) => {
      reconcile(state.projects, prevState.projects);
    });
  }, []);
}
