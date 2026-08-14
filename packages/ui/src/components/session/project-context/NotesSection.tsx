import React from 'react';

import { toast } from '@/components/ui';
import { Icon } from '@/components/icon/Icon';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n';
import { PROJECT_NOTE_BODY_MAX_LENGTH, type ProjectNote, type ProjectRef } from '@/lib/projectContextApi';
import { cn } from '@/lib/utils';
import { useProjectContextStore } from '@/stores/useProjectContextStore';
import { useUIStore } from '@/stores/useUIStore';

const NOTE_SAVE_DEBOUNCE_MS = 400;

/**
 * One note, edited in place.
 *
 * The draft is local and debounced: writing straight through on every keystroke
 * would put a request behind every character, and re-reading the store on every
 * render would fight the caret. The stored body is adopted only while the
 * editor is untouched since its last save, so a concurrent write from another
 * surface reaches an idle row without eating an active one.
 */
const NoteRow: React.FC<{
  note: ProjectNote;
  onSaveBody: (body: string) => void;
  onTogglePinned: () => void;
  onDelete: () => void;
}> = ({ note, onSaveBody, onTogglePinned, onDelete }) => {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState(note.body);
  const lastSavedRef = React.useRef(note.body);
  const debounceRef = React.useRef<number | null>(null);

  const cancelDebounce = React.useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (note.body === lastSavedRef.current) {
      return;
    }
    if (draft !== lastSavedRef.current) {
      return;
    }
    lastSavedRef.current = note.body;
    setDraft(note.body);
  }, [draft, note.body]);

  React.useEffect(() => {
    if (draft === lastSavedRef.current) {
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      // An empty body is a rejected write, not a delete. Leave it unsaved so
      // the row stays visible and the user can either restore it or delete it.
      if (!draft.trim()) {
        return;
      }
      lastSavedRef.current = draft;
      onSaveBody(draft);
    }, NOTE_SAVE_DEBOUNCE_MS);

    return cancelDebounce;
  }, [cancelDebounce, draft, onSaveBody]);

  React.useEffect(() => cancelDebounce, [cancelDebounce]);

  const handleBlur = React.useCallback(() => {
    cancelDebounce();
    if (draft === lastSavedRef.current) {
      return;
    }
    if (!draft.trim()) {
      // Restore rather than persist a blank: the server rejects it anyway.
      setDraft(lastSavedRef.current);
      return;
    }
    lastSavedRef.current = draft;
    onSaveBody(draft);
  }, [cancelDebounce, draft, onSaveBody]);

  const sourceLabel = note.source === 'selection'
    ? t('rightSidebar.contextNotesTodo.notes.source.selection')
    : note.source === 'agent'
      ? t('rightSidebar.contextNotesTodo.notes.source.agent')
      : null;

  return (
    <li className="space-y-1 px-2.5 py-2">
      <div className="flex items-start gap-1.5">
        <Textarea
          simple
          rows={Math.min(8, Math.max(1, draft.split('\n').length))}
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, PROJECT_NOTE_BODY_MAX_LENGTH))}
          onBlur={handleBlur}
          className="min-h-0 w-full flex-1 resize-none bg-transparent p-0 typography-ui-label leading-normal text-foreground focus-visible:outline-none focus-visible:ring-0"
        />
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onTogglePinned}
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              note.pinned ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={note.pinned}
            aria-label={note.pinned
              ? t('rightSidebar.contextNotesTodo.notes.actions.unpin')
              : t('rightSidebar.contextNotesTodo.notes.actions.pin')}
            title={note.pinned
              ? t('rightSidebar.contextNotesTodo.notes.actions.unpin')
              : t('rightSidebar.contextNotesTodo.notes.actions.pin')}
          >
            <Icon name="pushpin" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={t('rightSidebar.contextNotesTodo.notes.actions.delete')}
            title={t('rightSidebar.contextNotesTodo.notes.actions.delete')}
          >
            <Icon name="delete-bin" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {sourceLabel ? (
        <span className="typography-micro text-muted-foreground">{sourceLabel}</span>
      ) : null}
    </li>
  );
};

/**
 * Free-form project notes, one entry per note.
 *
 * Notes are written through their own routes, so this section owns its writes
 * end to end — nothing here has to be persisted alongside todos.
 */
export const NotesSection: React.FC<{
  projectRef: ProjectRef;
  projectLabel?: string | null;
  notes: ProjectNote[];
  disabled: boolean;
  query: string;
}> = ({ projectRef, projectLabel, notes, disabled, query }) => {
  const { t } = useI18n();
  const [composerText, setComposerText] = React.useState('');
  const notesPanelHeight = useUIStore((state) => state.notesPanelHeight);
  const setNotesPanelHeight = useUIStore((state) => state.setNotesPanelHeight);
  const createNote = useProjectContextStore((state) => state.createNote);
  const saveNoteBody = useProjectContextStore((state) => state.saveNoteBody);
  const setNotePinned = useProjectContextStore((state) => state.setNotePinned);
  const deleteNote = useProjectContextStore((state) => state.deleteNote);

  const title = projectLabel?.trim()
    || projectRef.path.split('/').filter(Boolean).pop()
    || projectRef.path;

  const visibleNotes = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter((note) => note.body.toLowerCase().includes(needle));
  }, [notes, query]);

  const handleAdd = React.useCallback(async () => {
    const body = composerText.trim();
    if (!body) {
      return;
    }
    const created = await createNote(projectRef, { body });
    if (!created) {
      toast.error(t('rightSidebar.contextNotesTodo.toast.createNoteFailed'));
      return;
    }
    setComposerText('');
  }, [composerText, createNote, projectRef, t]);

  const handleDelete = React.useCallback(
    async (noteId: string) => {
      const ok = await deleteNote(projectRef, noteId);
      if (!ok) {
        toast.error(t('rightSidebar.contextNotesTodo.toast.deleteNoteFailed'));
      }
    },
    [deleteNote, projectRef, t]
  );

  const handleSaveBody = React.useCallback(
    (noteId: string, body: string) => {
      void saveNoteBody(projectRef, noteId, body).then((ok: boolean) => {
        if (!ok) {
          toast.error(t('rightSidebar.contextNotesTodo.toast.saveNotesFailed'));
        }
      });
    },
    [projectRef, saveNoteBody, t]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 truncate typography-ui-label font-semibold text-foreground" title={projectRef.path}>
            {t('rightSidebar.contextNotesTodo.notes.title', { project: title })}
          </h3>
          <span className="flex-shrink-0 typography-meta text-muted-foreground">
            {notes.length === 1
              ? t('rightSidebar.contextNotesTodo.notes.notesSingle', { count: notes.length })
              : t('rightSidebar.contextNotesTodo.notes.notesPlural', { count: notes.length })}
          </span>
        </div>
        <span className="typography-meta text-muted-foreground">
          {composerText.length}/{PROJECT_NOTE_BODY_MAX_LENGTH}
        </span>
      </div>

      <div className="flex items-start gap-1.5">
        <Textarea
          value={composerText}
          onChange={(event) => setComposerText(event.target.value.slice(0, PROJECT_NOTE_BODY_MAX_LENGTH))}
          placeholder={t('rightSidebar.contextNotesTodo.notes.placeholder')}
          resizedHeight={notesPanelHeight}
          onResizeHeightChange={setNotesPanelHeight}
          useScrollShadow
          scrollShadowSize={56}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={disabled || composerText.trim().length === 0}
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t('rightSidebar.contextNotesTodo.notes.addAria')}
          title={t('rightSidebar.contextNotesTodo.notes.addAria')}
        >
          <Icon name="add" className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto rounded-lg border border-border/60 bg-background/40">
        {visibleNotes.length === 0 ? (
          <p className="px-3 py-3 typography-meta text-muted-foreground">
            {query.trim()
              ? t('rightSidebar.contextNotesTodo.search.noResults', { query: query.trim() })
              : t('rightSidebar.contextNotesTodo.notes.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {visibleNotes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                onSaveBody={(body) => handleSaveBody(note.id, body)}
                onTogglePinned={() => void setNotePinned(projectRef, note.id, !note.pinned)}
                onDelete={() => void handleDelete(note.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
