import React from 'react';

import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import type { AgentMemoryEntry, AgentMemoryScope } from '@/lib/agentMemoryApi';
import { classifyMemory, memoryViewKey, type MemoryBadge } from '@/lib/agentMemoryBadges';
import { cn } from '@/lib/utils';
import { useAgentMemoryStore } from '@/stores/useAgentMemoryStore';
import { useUIStore } from '@/stores/useUIStore';

/**
 * One stored memory.
 *
 * Read-only text on purpose: this is what the agent wrote, and the useful
 * action on someone else's claim is to remove it, not to quietly rewrite it
 * into something the agent will contradict next session.
 *
 * There is no confirm button. A badge that the user has to dismiss by hand asks
 * them to do work that tells the agent nothing — the agent already has the
 * memory either way — so the badge clears itself once they have looked.
 */
const MemoryRow: React.FC<{
  entry: AgentMemoryEntry;
  badge: MemoryBadge;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDelete: () => void;
}> = ({ entry, badge, expanded, onToggleExpanded, onDelete }) => {
  const { t } = useI18n();

  const typeLabel = t(`rightSidebar.contextNotesTodo.memory.type.${entry.type}` as Parameters<typeof t>[0]);

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-2 py-1.5">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggleExpanded}
            className="flex w-full min-w-0 items-center gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-expanded={expanded}
          >
            {badge ? (
              <span
                className={cn(
                  'flex-shrink-0 rounded-full px-1.5 py-px typography-micro font-medium',
                  badge === 'new'
                    ? 'bg-[var(--status-success)]/15 text-[var(--status-success)]'
                    : 'bg-[var(--status-warning)]/15 text-[var(--status-warning)]',
                )}
              >
                {t(badge === 'new'
                  ? 'rightSidebar.contextNotesTodo.memory.badge.new'
                  : 'rightSidebar.contextNotesTodo.memory.badge.changed')}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate typography-ui-label text-foreground">
              {entry.title}
            </span>
            <Icon
              name={expanded ? 'arrow-up-s' : 'arrow-down-s'}
              className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground"
            />
          </button>
          <p className={cn('typography-meta text-muted-foreground', expanded ? '' : 'line-clamp-2')}>
            {entry.body}
          </p>
        </div>

        <button
          type="button"
          onClick={onDelete}
          className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={t('rightSidebar.contextNotesTodo.memory.actions.delete')}
          title={t('rightSidebar.contextNotesTodo.memory.actions.delete')}
        >
          <Icon name="delete-bin" className="h-3.5 w-3.5" />
        </button>
      </div>

      <span className="typography-micro text-muted-foreground">{typeLabel}</span>
    </li>
  );
};

/**
 * What the agent has chosen to remember, in the two scopes it writes to.
 *
 * The scopes are a switch rather than one merged list: a claim about the user
 * reaches every project, so which store a memory sits in is the most important
 * thing about it and must never be something the reader has to infer.
 */
export const MemorySection: React.FC<{
  projectPath: string | null;
  query: string;
}> = ({ projectPath, query }) => {
  const { t } = useI18n();
  const [scope, setScope] = React.useState<AgentMemoryScope>('project');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const globalEntries = useAgentMemoryStore((state) => state.global);
  const projectEntries = useAgentMemoryStore((state) => state.project);
  const globalFailed = useAgentMemoryStore((state) => state.globalFailed);
  const projectFailed = useAgentMemoryStore((state) => state.projectFailed);
  const deleteEntry = useAgentMemoryStore((state) => state.deleteEntry);
  const markViewed = useUIStore((state) => state.markAgentMemoryViewed);

  const entries = scope === 'global' ? globalEntries : projectEntries;
  const scopeFailed = scope === 'global' ? globalFailed : projectFailed;
  const viewKey = memoryViewKey(scope, projectPath);
  const storedViewedAt = useUIStore((state) => state.agentMemoryViewedAt[viewKey] ?? 0);

  /**
   * The mark is frozen for the length of the visit and only advanced on the way
   * out. Reading the live value would clear every badge the instant the tab
   * opened, which is the one moment the user is trying to read them.
   */
  const baselineRef = React.useRef(storedViewedAt);
  const [baseline, setBaseline] = React.useState(storedViewedAt);
  React.useEffect(() => {
    baselineRef.current = useUIStore.getState().agentMemoryViewedAt[viewKey] ?? 0;
    setBaseline(baselineRef.current);
    return () => {
      markViewed(viewKey, Date.now());
    };
  }, [markViewed, viewKey]);

  const visibleEntries = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => (
      entry.title.toLowerCase().includes(needle) || entry.body.toLowerCase().includes(needle)
    ));
  }, [entries, query]);

  const handleDelete = React.useCallback(async (memoryId: string) => {
    if (!await deleteEntry(scope, memoryId)) {
      const detail = useAgentMemoryStore.getState().error;
      toast.error(
        t('rightSidebar.contextNotesTodo.memory.toast.deleteFailed'),
        detail ? { description: detail } : undefined,
      );
    }
  }, [deleteEntry, scope, t]);

  const scopeOptions: Array<{ id: AgentMemoryScope; label: string; count: number }> = [
    { id: 'project', label: t('rightSidebar.contextNotesTodo.memory.scope.project'), count: projectEntries.length },
    { id: 'global', label: t('rightSidebar.contextNotesTodo.memory.scope.global'), count: globalEntries.length },
  ];

  return (
    <div className="flex flex-col gap-2">
      {/* Chips rather than a tab strip: these pick which store you are reading,
          not which view you are in, and the chip's pressed state says which one
          is selected far more plainly than a pill sitting on a matching
          background did. */}
      <div role="group" aria-label={t('rightSidebar.contextNotesTodo.memory.scope.label')} className="flex items-center gap-1">
        {scopeOptions.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant="chip"
            size="xs"
            aria-pressed={scope === option.id}
            className="!font-normal"
            onClick={() => setScope(option.id)}
          >
            {`${option.label} ${option.count}`}
          </Button>
        ))}
      </div>

      {scope === 'project' && !projectPath ? (
        <p className="typography-meta text-muted-foreground">
          {t('rightSidebar.contextNotesTodo.memory.empty.noProject')}
        </p>
      ) : scopeFailed ? (
        // Said plainly rather than shown as an empty list: an empty tab would
        // read as the agent having forgotten everything it knew.
        <p className="typography-meta text-muted-foreground">
          {t('rightSidebar.contextNotesTodo.memory.empty.unavailable')}
        </p>
      ) : visibleEntries.length === 0 ? (
        <p className="typography-meta text-muted-foreground">
          {query.trim()
            ? t('rightSidebar.contextNotesTodo.memory.empty.noMatches')
            : t('rightSidebar.contextNotesTodo.memory.empty.nothing')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visibleEntries.map((entry) => (
            <MemoryRow
              key={entry.id}
              entry={entry}
              badge={classifyMemory(entry, baseline)}
              expanded={expandedId === entry.id}
              onToggleExpanded={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              onDelete={() => void handleDelete(entry.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
