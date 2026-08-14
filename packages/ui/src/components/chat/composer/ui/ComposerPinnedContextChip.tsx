/**
 * Indicator for pinned project context.
 *
 * Pinned notes and plans are attached by the send path, not by the composer, so
 * without this the user has no way to see that extra context is riding along.
 *
 * Its remove action unpins everything the chip counts, matching the sibling
 * context chips: the chip stands for a set, and clearing it clears that set.
 * Unlike those, this one is not a per-message draft — it changes project state,
 * which is why it is worded as "unpin" and mirrored by the pin toggles in the
 * notes panel.
 */

import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useI18n } from '@/lib/i18n';
import { resolveProjectContextId, type ProjectRef } from '@/lib/projectContextApi';
import { countPinnedItems, selectPinnedItems } from '@/lib/projectContextPinning';
import { resolveProjectForSessionDirectory } from '@/lib/projectResolution';
import { useProjectContextStore } from '@/stores/useProjectContextStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

export function ComposerPinnedContextChip() {
  const { t } = useI18n();
  const projects = useProjectsStore((state) => state.projects);
  const availableWorktreesByProject = useSessionUIStore((state) => state.availableWorktreesByProject);
  const effectiveDirectory = useEffectiveDirectory() ?? '';

  const projectRef = React.useMemo<ProjectRef | null>(() => {
    const resolved = resolveProjectForSessionDirectory(projects, availableWorktreesByProject, effectiveDirectory);
    return resolved ? { id: resolved.id, path: resolved.path } : null;
  }, [availableWorktreesByProject, effectiveDirectory, projects]);

  const projectContextId = React.useMemo(
    () => (projectRef ? resolveProjectContextId(projectRef) : ''),
    [projectRef],
  );

  const pinnedCount = useProjectContextStore((state) => {
    const entry = projectContextId ? state.entries[projectContextId] : undefined;
    if (!entry) return 0;
    return countPinnedItems(selectPinnedItems(entry));
  });

  const handleUnpinAll = React.useCallback(async () => {
    if (!projectRef || !projectContextId) {
      return;
    }
    const store = useProjectContextStore.getState();
    const entry = store.entries[projectContextId];
    if (!entry) {
      return;
    }
    const { notes, plans } = selectPinnedItems(entry);
    // Sequential on purpose: the store serializes writes per project anyway, and
    // firing them together would only queue the same requests behind each other.
    for (const note of notes) {
      await store.setNotePinned(projectRef, note.id, false);
    }
    for (const plan of plans) {
      await store.setPlanPinned(projectRef, plan.id, false);
    }
  }, [projectContextId, projectRef]);

  if (pinnedCount === 0) {
    return null;
  }

  const label = pinnedCount === 1
    ? t('chat.chatInput.pinnedContextSingle', { count: pinnedCount })
    : t('chat.chatInput.pinnedContextPlural', { count: pinnedCount });
  const removeLabel = t('chat.chatInput.pinnedContextRemove');

  return (
    <div className="flex flex-wrap items-center gap-2 pb-2">
      <div
        className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-2.5 py-1"
        title={t('chat.chatInput.pinnedContextTooltip')}
      >
        <Icon name="pushpin" className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <button
          type="button"
          className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-interactive-hover hover:text-foreground"
          style={{ minHeight: 0, minWidth: 0 }}
          onClick={() => void handleUnpinAll()}
          aria-label={removeLabel}
          title={removeLabel}
        >
          <Icon name="close" className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
