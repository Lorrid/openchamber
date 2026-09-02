import React, { memo } from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { getGitStatus } from '@/lib/gitApi';
import { isChatDirectoryPath } from '@/lib/chatDirectories';
import { createWorktreeDraft } from '@/lib/worktreeSessionCreator';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

/**
 * Informational notice on a new project-session draft whose target directory
 * has uncommitted changes: the session would work in the same files as
 * whatever produced them. Never blocks anything — it names the situation and
 * offers a worktree, which converts this draft to an isolated copy in place.
 */
export const NewSessionDirtyDirectoryNotice = memo(() => {
  const { t } = useI18n();
  const draftOpen = useSessionUIStore((state) => state.newSessionDraft.open);
  const draftTarget = useSessionUIStore((state) => state.newSessionDraft.target);
  const draftDirectory = useSessionUIStore((state) => state.newSessionDraft.directoryOverride);
  const pendingWorktreeRequestId = useSessionUIStore((state) => state.newSessionDraft.pendingWorktreeRequestId);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);

  const [dirtyState, setDirtyState] = React.useState<{ directory: string; fileCount: number } | null>(null);
  const [dismissedDirectory, setDismissedDirectory] = React.useState<string | null>(null);
  const [isConverting, setIsConverting] = React.useState(false);

  const targetDirectory = draftOpen && draftTarget === 'project'
    ? (draftDirectory ?? currentDirectory ?? null)
    : null;

  React.useEffect(() => {
    if (!targetDirectory || isChatDirectoryPath(targetDirectory)) {
      setDirtyState(null);
      return;
    }
    let cancelled = false;
    getGitStatus(targetDirectory, { mode: 'light' })
      .then((status) => {
        if (cancelled) return;
        const fileCount = status.files?.length ?? 0;
        setDirtyState(fileCount > 0 ? { directory: targetDirectory, fileCount } : null);
      })
      .catch(() => {
        // Not a repository or status unavailable — an informational notice
        // must never surface a fetch problem as a warning about the project.
        if (!cancelled) setDirtyState(null);
      });
    return () => { cancelled = true; };
  }, [targetDirectory]);

  if (
    !targetDirectory
    || pendingWorktreeRequestId
    || !dirtyState
    || dirtyState.directory !== targetDirectory
    || dismissedDirectory === targetDirectory
  ) {
    return null;
  }

  const handleWorktree = async () => {
    setIsConverting(true);
    try {
      await createWorktreeDraft();
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div className="pb-2 w-full px-1">
      <div className="rounded-xl border border-border/60 bg-[var(--surface-elevated)] text-[var(--surface-elevated-foreground)] shadow-sm overflow-hidden">
        <div className="flex w-full items-center gap-2 px-3 py-2 text-left">
          <Icon name="information" className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <span className="typography-ui-label font-medium text-foreground">
              {dirtyState.fileCount === 1
                ? t('chat.draftDirtyNotice.titleSingle')
                : t('chat.draftDirtyNotice.titlePlural', { count: dirtyState.fileCount })}
            </span>
            <div className="typography-meta text-muted-foreground">
              {t('chat.draftDirtyNotice.description')}
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={isConverting}
            onClick={() => { void handleWorktree(); }}
            className="gap-1.5"
          >
            {isConverting ? (
              <Icon name="loader-4" className="size-3.5 animate-spin" />
            ) : (
              <Icon name="git-branch" className="size-3.5" />
            )}
            {t('chat.draftDirtyNotice.actions.worktree')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label={t('chat.draftDirtyNotice.actions.dismissAria')}
            onClick={() => setDismissedDirectory(targetDirectory)}
          >
            <Icon name="close" className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
});

NewSessionDirtyDirectoryNotice.displayName = 'NewSessionDirtyDirectoryNotice';
