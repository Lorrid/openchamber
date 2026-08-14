/**
 * Indicator for pinned project context.
 *
 * Pinned notes and plans are attached by the send path, not by the composer, so
 * without this the user has no way to see that extra context is riding along.
 * It is deliberately not removable here: unpinning is a project-level decision
 * made in the notes panel, not a per-message one.
 */

import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useI18n } from '@/lib/i18n';
import { resolveProjectContextId } from '@/lib/projectContextApi';
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

  const projectContextId = React.useMemo(() => {
    const resolved = resolveProjectForSessionDirectory(projects, availableWorktreesByProject, effectiveDirectory);
    return resolved ? resolveProjectContextId({ id: resolved.id, path: resolved.path }) : '';
  }, [availableWorktreesByProject, effectiveDirectory, projects]);

  const pinnedCount = useProjectContextStore((state) => {
    const entry = projectContextId ? state.entries[projectContextId] : undefined;
    if (!entry) return 0;
    return countPinnedItems(selectPinnedItems(entry));
  });

  if (pinnedCount === 0) {
    return null;
  }

  const label = pinnedCount === 1
    ? t('chat.chatInput.pinnedContextSingle', { count: pinnedCount })
    : t('chat.chatInput.pinnedContextPlural', { count: pinnedCount });

  return (
    <div className="flex flex-wrap items-center gap-2 pb-2">
      <div
        className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-2.5 py-1"
        title={t('chat.chatInput.pinnedContextTooltip')}
      >
        <Icon name="pushpin" className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
