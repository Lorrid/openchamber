import React from 'react';

import { toast } from '@/components/ui';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import type { AgentMemoryEntry, AgentMemoryScope } from '@/lib/agentMemoryApi';
import { cn } from '@/lib/utils';
import { useAgentMemoryStore } from '@/stores/useAgentMemoryStore';

/**
 * One stored memory.
 *
 * Read-only text on purpose: this is what the agent wrote, and the useful
 * actions on someone else's claim are to confirm it or remove it, not to
 * quietly rewrite it into something the agent will contradict next session.
 */
const MemoryRow: React.FC<{
  entry: AgentMemoryEntry;
  expanded: boolean;
  onToggleExpanded: () => void;
  onConfirm: () => void;
  onDelete: () => void;
}> = ({ entry, expanded, onToggleExpanded, onConfirm, onDelete }) => {
  const { t } = useI18n();

  const typeLabel = t(`rightSidebar.contextNotesTodo.memory.type.${entry.type}` as Parameters<typeof t>[0]);

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-2 py-1.5">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggleExpanded}
            className="flex w-full min-w-0 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm"
            aria-expanded={expanded}
          >
            {!entry.reviewed ? (
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--status-warning)]"
                aria-hidden="true"
              />
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

        <div className="flex flex-shrink-0 flex-col gap-0.5">
          {!entry.reviewed ? (
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-label={t('rightSidebar.contextNotesTodo.memory.actions.confirm')}
              title={t('rightSidebar.contextNotesTodo.memory.actions.confirm')}
            >
              <Icon name="check" className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={t('rightSidebar.contextNotesTodo.memory.actions.delete')}
            title={t('rightSidebar.contextNotesTodo.memory.actions.delete')}
          >
            <Icon name="delete-bin" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <span className="typography-micro text-muted-foreground">
        {entry.reviewed
          ? typeLabel
          : `${typeLabel} · ${t('rightSidebar.contextNotesTodo.memory.unreviewed')}`}
      </span>
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
  const setReviewed = useAgentMemoryStore((state) => state.setReviewed);
  const deleteEntry = useAgentMemoryStore((state) => state.deleteEntry);

  const entries = scope === 'global' ? globalEntries : projectEntries;
  const scopeFailed = scope === 'global' ? globalFailed : projectFailed;

  const visibleEntries = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => (
      entry.title.toLowerCase().includes(needle) || entry.body.toLowerCase().includes(needle)
    ));
  }, [entries, query]);

  const reportFailure = React.useCallback((message: string) => {
    const detail = useAgentMemoryStore.getState().error;
    toast.error(message, detail ? { description: detail } : undefined);
  }, []);

  const handleConfirm = React.useCallback(async (memoryId: string) => {
    if (!await setReviewed(scope, memoryId, true)) {
      reportFailure(t('rightSidebar.contextNotesTodo.memory.toast.confirmFailed'));
    }
  }, [reportFailure, scope, setReviewed, t]);

  const handleDelete = React.useCallback(async (memoryId: string) => {
    if (!await deleteEntry(scope, memoryId)) {
      reportFailure(t('rightSidebar.contextNotesTodo.memory.toast.deleteFailed'));
    }
  }, [deleteEntry, reportFailure, scope, t]);

  const scopeButton = (value: AgentMemoryScope, label: string, count: number) => (
    <button
      type="button"
      onClick={() => setScope(value)}
      aria-pressed={scope === value}
      className={cn(
        'flex-1 rounded-md px-2 py-1 typography-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        scope === value
          ? 'bg-[var(--surface-elevated)] text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
      style={{ minHeight: 0 }}
    >
      {`${label} ${count}`}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 rounded-lg bg-[var(--surface-subtle)] p-0.5">
        {scopeButton('project', t('rightSidebar.contextNotesTodo.memory.scope.project'), projectEntries.length)}
        {scopeButton('global', t('rightSidebar.contextNotesTodo.memory.scope.global'), globalEntries.length)}
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
              expanded={expandedId === entry.id}
              onToggleExpanded={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              onConfirm={() => void handleConfirm(entry.id)}
              onDelete={() => void handleDelete(entry.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
