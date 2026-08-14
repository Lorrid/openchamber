import React from 'react';

import { toast } from '@/components/ui';
import { Icon } from '@/components/icon/Icon';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n';
import { resolveProjectContextId, type ProjectRef, type ProjectTodoItem } from '@/lib/projectContextApi';
import { cn } from '@/lib/utils';
import { EMPTY_PROJECT_CONTEXT_ENTRY, useProjectContextStore } from '@/stores/useProjectContextStore';
import { TodoSendDialog } from '../TodoSendDialog';
import { NotesSection } from './NotesSection';
import { PlansSection } from './PlansSection';
import { TodosSection } from './TodosSection';
import { useProjectTodoSend } from './useProjectTodoSend';

interface ProjectNotesTodoPanelProps {
  projectRef: ProjectRef | null;
  projectLabel?: string | null;
  canCreateWorktree?: boolean;
  onActionComplete?: () => void;
  /** When provided, opening a plan calls this instead of the desktop context
      panel tab — hosts without ContextPanel (mobile) render their own viewer. */
  onOpenPlan?: (plan: { id: string; title: string }) => void;
  className?: string;
}

const sortTodosWithCompletedLast = (items: ProjectTodoItem[]): ProjectTodoItem[] => [
  ...items.filter((todo) => !todo.completed),
  ...items.filter((todo) => todo.completed),
];

/**
 * Notes, todos, and plans for the active project.
 *
 * Storage is server-owned and reached through `useProjectContextStore`. This
 * container owns only what the sections genuinely share: the loaded snapshot,
 * the search query, and the todo write.
 */
export const ProjectNotesTodoPanel: React.FC<ProjectNotesTodoPanelProps> = ({
  projectRef,
  projectLabel,
  canCreateWorktree = false,
  onActionComplete,
  onOpenPlan,
  className,
}) => {
  const { t } = useI18n();

  const projectContextId = React.useMemo(() => resolveProjectContextId(projectRef), [projectRef]);
  const contextEntry = useProjectContextStore(
    (state) => (projectContextId ? state.entries[projectContextId] : undefined) ?? EMPTY_PROJECT_CONTEXT_ENTRY,
  );
  const loadProjectContext = useProjectContextStore((state) => state.load);
  const saveTodos = useProjectContextStore((state) => state.saveTodos);
  const [query, setQuery] = React.useState('');

  // Completed items sink to the bottom in the list; storage order is untouched.
  const todos = React.useMemo(
    () => sortTodosWithCompletedLast(contextEntry.todos),
    [contextEntry.todos],
  );
  const isLoading = contextEntry.loading && !contextEntry.loaded;

  const send = useProjectTodoSend({ projectRef, canCreateWorktree, onActionComplete });

  React.useEffect(() => {
    if (!projectRef) {
      return;
    }
    void loadProjectContext(projectRef);
  }, [loadProjectContext, projectRef]);

  // Surface a load failure once. The store keeps whatever it already had, so
  // the panel never blanks out over an unreachable server.
  const reportedErrorRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!contextEntry.error) {
      reportedErrorRef.current = null;
      return;
    }
    if (reportedErrorRef.current === contextEntry.error) {
      return;
    }
    reportedErrorRef.current = contextEntry.error;
    if (!contextEntry.loaded) {
      toast.error(t('rightSidebar.contextNotesTodo.toast.loadNotesFailed'));
    }
  }, [contextEntry.error, contextEntry.loaded, t]);

  // Reset the filter when the project changes: a query that matched the old
  // project would silently hide everything in the new one.
  React.useEffect(() => {
    setQuery('');
  }, [projectContextId]);

  const handlePersistTodos = React.useCallback(
    (nextTodos: ProjectTodoItem[]) => {
      if (!projectRef) {
        return;
      }
      // The store owns per-project write serialization and rollback; the panel
      // only decides what to persist and how to report a failure.
      void saveTodos(projectRef, nextTodos).then((saved) => {
        if (!saved) {
          toast.error(t('rightSidebar.contextNotesTodo.toast.saveNotesFailed'));
        }
      });
    },
    [projectRef, saveTodos, t]
  );

  if (!projectRef) {
    return (
      <div className={cn('w-full min-w-0 p-3', className)}>
        <p className="typography-meta text-muted-foreground">
          {t('rightSidebar.contextNotesTodo.empty.selectProject')}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('w-full min-w-0 space-y-3 p-3', className)}>
      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('rightSidebar.contextNotesTodo.search.placeholder')}
          className="h-8 pl-7 pr-7"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={t('rightSidebar.contextNotesTodo.search.clear')}
            title={t('rightSidebar.contextNotesTodo.search.clear')}
          >
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <NotesSection
        projectRef={projectRef}
        projectLabel={projectLabel}
        notes={contextEntry.notes}
        disabled={isLoading}
        query={query}
      />

      <TodosSection
        todos={todos}
        query={query}
        disabled={isLoading}
        canCreateWorktree={canCreateWorktree}
        sendingTodoId={send.sendingTodoId}
        onPersistTodos={handlePersistTodos}
        onSendToCurrentSession={send.sendToCurrentSession}
        onSendToNewSession={send.sendToNewSession}
        onSendToNewWorktreeSession={send.sendToNewWorktreeSession}
      />

      <PlansSection
        projectRef={projectRef}
        plans={contextEntry.plans}
        query={query}
        onOpenPlan={onOpenPlan}
      />

      <TodoSendDialog
        open={send.pendingSendTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            send.closeDialog();
          }
        }}
        target={send.pendingSendTarget?.kind ?? 'session'}
        projectDirectory={projectRef.path}
        submitting={send.isSubmitting}
        onConfirm={send.confirmSend}
      />
    </div>
  );
};
