import React from 'react';

import { toast } from '@/components/ui';
import { Icon } from '@/components/icon/Icon';
import { Input } from '@/components/ui/input';
import { SortableTabsStrip, type SortableTabsStripItem } from '@/components/ui/sortable-tabs-strip';
import { useI18n } from '@/lib/i18n';
import { resolveProjectContextId, type ProjectRef, type ProjectTodoItem } from '@/lib/projectContextApi';
import { cn } from '@/lib/utils';
import { useAgentMemoryStore } from '@/stores/useAgentMemoryStore';
import { countHighlightedMemories, memoryViewKey } from '@/lib/agentMemoryBadges';
import { subscribeOpenchamberEvents } from '@/lib/openchamberEvents';
import { EMPTY_PROJECT_CONTEXT_ENTRY, useProjectContextStore } from '@/stores/useProjectContextStore';
import { useUIStore } from '@/stores/useUIStore';
import { TodoSendDialog } from '../TodoSendDialog';
import { MemorySection } from './MemorySection';
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

type ProjectContextTab = 'notes' | 'todos' | 'plans' | 'memory';

const TAB_ORDER: ProjectContextTab[] = ['notes', 'todos', 'plans', 'memory'];

const sortTodosWithCompletedLast = (items: ProjectTodoItem[]): ProjectTodoItem[] => [
  ...items.filter((todo) => !todo.completed),
  ...items.filter((todo) => todo.completed),
];

const matches = (haystack: string, needle: string): boolean => (
  haystack.toLowerCase().includes(needle)
);

/**
 * Notes, todos, and plans for the active project.
 *
 * The three lists are tabs rather than one stacked column: stacking gave each
 * list its own scroller inside the panel's scroller, which only got worse as
 * lists grew and forced the todo list to carry a manual resize handle just to
 * stay usable.
 *
 * Search sits above the tabs and stays panel-wide. Tabs divide, and search is
 * the one thing that division would hurt — you do not always remember whether
 * something was written as a note or lives in a plan — so the tab bar doubles
 * as the result summary by showing per-tab match counts.
 *
 * Storage is server-owned and reached through `useProjectContextStore`.
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

  // The whole feature is one switch: with memory off there is nothing for the
  // agent to manage, so showing the user what is stored would be pointless.
  const memoryEnabled = useUIStore((state) => state.agentMemoryToolEnabled);
  const memoryDisabledByServer = useAgentMemoryStore((state) => state.disabled);
  const memoryVisible = memoryEnabled && !memoryDisabledByServer;
  const loadAgentMemory = useAgentMemoryStore((state) => state.load);
  const globalMemory = useAgentMemoryStore((state) => state.global);
  const projectMemory = useAgentMemoryStore((state) => state.project);

  const storedTab = useUIStore((state) => state.projectContextTab);
  const setStoredTab = useUIStore((state) => state.setProjectContextTab);
  const requestedTab = TAB_ORDER.includes(storedTab as ProjectContextTab)
    ? storedTab as ProjectContextTab
    : 'notes';
  // A persisted 'memory' must not survive the feature being turned off, or the
  // panel would open on a tab that no longer exists.
  const activeTab: ProjectContextTab = requestedTab === 'memory' && !memoryVisible
    ? 'notes'
    : requestedTab;

  const [query, setQuery] = React.useState('');
  const trimmedQuery = query.trim().toLowerCase();

  // Completed items sink to the bottom in the list; storage order is untouched.
  const todos = React.useMemo(
    () => sortTodosWithCompletedLast(contextEntry.todos),
    [contextEntry.todos],
  );
  const isLoading = contextEntry.loading && !contextEntry.loaded;

  const memoryEntries = React.useMemo(
    () => [...globalMemory, ...projectMemory],
    [globalMemory, projectMemory],
  );

  const counts = React.useMemo(() => {
    if (!trimmedQuery) {
      return {
        notes: contextEntry.notes.length,
        todos: todos.length,
        plans: contextEntry.plans.length,
        memory: memoryEntries.length,
      };
    }
    return {
      notes: contextEntry.notes.filter((note) => matches(note.body, trimmedQuery)).length,
      todos: todos.filter((todo) => matches(todo.text, trimmedQuery)).length,
      plans: contextEntry.plans.filter((plan) => matches(plan.title, trimmedQuery)).length,
      memory: memoryEntries.filter((entry) => (
        matches(entry.title, trimmedQuery) || matches(entry.body, trimmedQuery)
      )).length,
    };
  }, [contextEntry.notes, contextEntry.plans, memoryEntries, todos, trimmedQuery]);

  // Counted across both scopes against their own marks: a new global memory is
  // the one the user most needs to see, and it would be invisible behind the
  // project scope.
  const globalViewedAt = useUIStore((state) => state.agentMemoryViewedAt[memoryViewKey('global', null)] ?? 0);
  const projectViewedAt = useUIStore(
    (state) => state.agentMemoryViewedAt[memoryViewKey('project', projectRef?.path ?? null)] ?? 0,
  );
  const highlightedMemoryCount = React.useMemo(
    () => countHighlightedMemories(globalMemory, globalViewedAt)
      + countHighlightedMemories(projectMemory, projectViewedAt),
    [globalMemory, globalViewedAt, projectMemory, projectViewedAt],
  );

  const send = useProjectTodoSend({ projectRef, canCreateWorktree, onActionComplete });

  React.useEffect(() => {
    if (!projectRef) {
      return;
    }
    void loadProjectContext(projectRef);
  }, [loadProjectContext, projectRef]);

  const memoryProjectPath = projectRef?.path ?? null;
  React.useEffect(() => {
    if (!memoryEnabled) {
      return;
    }
    void loadAgentMemory(memoryProjectPath);
  }, [loadAgentMemory, memoryEnabled, memoryProjectPath]);

  // The agent writes memory during a turn, through its own tool. Without
  // listening for that, what it stored would only appear the next time the
  // panel happened to reload — which is how it looked like nothing had been
  // saved at all.
  React.useEffect(() => {
    if (!memoryEnabled) {
      return;
    }
    return subscribeOpenchamberEvents((event) => {
      if (event.type === 'agent-memory-changed') {
        void loadAgentMemory(memoryProjectPath);
      }
    });
  }, [loadAgentMemory, memoryEnabled, memoryProjectPath]);

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

  // Follow the search to where the matches are. Without this, typing a query
  // whose hits are all in another tab shows an empty list and the user has to
  // guess which tab to try. Only moves off a tab that has nothing.
  React.useEffect(() => {
    if (!trimmedQuery || counts[activeTab] > 0) {
      return;
    }
    const withMatches = TAB_ORDER.find((tab) => counts[tab] > 0);
    if (withMatches) {
      setStoredTab(withMatches);
    }
  }, [activeTab, counts, setStoredTab, trimmedQuery]);

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

  /**
   * No icons on these tabs. The labels are already plain words, so an icon adds
   * nothing to read but costs width the counts need — and with four tabs that
   * width is what pushed the last one off the edge.
   */
  const tabItems: SortableTabsStripItem[] = React.useMemo(() => ([
    {
      id: 'notes',
      label: `${t('rightSidebar.contextNotesTodo.tabs.notes')} ${counts.notes}`,
    },
    {
      id: 'todos',
      label: `${t('rightSidebar.contextNotesTodo.tabs.todos')} ${counts.todos}`,
    },
    {
      id: 'plans',
      label: `${t('rightSidebar.contextNotesTodo.tabs.plans')} ${counts.plans}`,
    },
    ...(memoryVisible ? [{
      id: 'memory',
      // The new/changed count replaces the total when there is anything the
      // user has not seen: what the agent stored without asking is the number
      // that deserves the glance.
      label: `${t('rightSidebar.contextNotesTodo.tabs.memory')} ${highlightedMemoryCount > 0 ? `${highlightedMemoryCount}/${counts.memory}` : counts.memory}`,
    }] : []),
  ]), [counts, highlightedMemoryCount, memoryVisible, t]);

  if (!projectRef) {
    return (
      <div className={cn('w-full min-w-0 p-3', className)}>
        <p className="typography-meta text-muted-foreground">
          {t('rightSidebar.contextNotesTodo.empty.selectProject')}
        </p>
      </div>
    );
  }

  const projectTitle = projectLabel?.trim()
    || projectRef.path.split('/').filter(Boolean).pop()
    || projectRef.path;

  return (
    <div className={cn('flex h-full min-h-0 w-full min-w-0 flex-col', className)}>
      <div className="flex flex-shrink-0 flex-col gap-2 p-3 pb-2">
        <h3
          className="min-w-0 truncate typography-ui-label font-semibold text-foreground"
          title={projectRef.path}
        >
          {projectTitle}
        </h3>

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

        <SortableTabsStrip
          items={tabItems}
          activeId={activeTab}
          onSelect={setStoredTab}
          // Scrollable, not fit: fit tabs refuse to shrink below their content
          // on desktop, so a panel too narrow for them silently clips the last
          // tab out of reach instead of letting the strip scroll.
          layoutMode="scrollable"
          variant="active-pill"
          className="h-8"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {activeTab === 'notes' ? (
          <NotesSection
            projectRef={projectRef}
            notes={contextEntry.notes}
            disabled={isLoading}
            query={query}
          />
        ) : null}

        {activeTab === 'todos' ? (
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
        ) : null}

        {activeTab === 'memory' && memoryVisible ? (
          <MemorySection projectPath={projectRef.path} query={query} />
        ) : null}

        {activeTab === 'plans' ? (
          <PlansSection
            projectRef={projectRef}
            plans={contextEntry.plans}
            query={query}
            onOpenPlan={onOpenPlan}
          />
        ) : null}
      </div>

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
