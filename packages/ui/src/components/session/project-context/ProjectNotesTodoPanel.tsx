import React from 'react';

import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { resolveProjectContextId, type ProjectRef, type ProjectTodoItem } from '@/lib/projectContextApi';
import { cn } from '@/lib/utils';
import { EMPTY_PROJECT_CONTEXT_ENTRY, useProjectContextStore } from '@/stores/useProjectContextStore';
import { TodoSendDialog } from '../TodoSendDialog';
import { NotesSection } from './NotesSection';
import { PlansSection } from './PlansSection';
import { TodosSection } from './TodosSection';
import { useProjectNotesDraft } from './useProjectNotesDraft';
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
 * and the notes draft that a todo write has to be persisted alongside.
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
  const saveNotesAndTodos = useProjectContextStore((state) => state.saveNotesAndTodos);

  // Completed items sink to the bottom in the list; storage order is untouched.
  const todos = React.useMemo(
    () => sortTodosWithCompletedLast(contextEntry.todos),
    [contextEntry.todos],
  );
  const isLoading = contextEntry.loading && !contextEntry.loaded;

  const persist = React.useCallback(
    async (nextNotes: string, nextTodos: ProjectTodoItem[]) => {
      if (!projectRef) {
        return false;
      }
      // The store owns per-project write serialization and rollback; the panel
      // only decides what to persist and how to report a failure.
      const saved = await saveNotesAndTodos(projectRef, { notes: nextNotes, todos: nextTodos });
      if (!saved) {
        toast.error(t('rightSidebar.contextNotesTodo.toast.saveNotesFailed'));
      }
      return saved;
    },
    [projectRef, saveNotesAndTodos, t]
  );

  const { notes, setNotes, handleNotesBlur } = useProjectNotesDraft({
    projectRef,
    projectContextId,
    storedNotes: contextEntry.notes,
    loaded: contextEntry.loaded,
    todos,
    persist,
  });

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

  const handlePersistTodos = React.useCallback(
    (nextTodos: ProjectTodoItem[]) => {
      void persist(notes, nextTodos);
    },
    [notes, persist]
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
      <NotesSection
        projectRef={projectRef}
        projectLabel={projectLabel}
        notes={notes}
        onNotesChange={setNotes}
        onNotesBlur={handleNotesBlur}
        disabled={isLoading}
      />

      <TodosSection
        todos={todos}
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
