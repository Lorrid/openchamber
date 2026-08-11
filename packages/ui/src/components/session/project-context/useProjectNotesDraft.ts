import React from 'react';

import type { ProjectRef, ProjectTodoItem } from '@/lib/projectContextApi';

const NOTES_SAVE_DEBOUNCE_MS = 400;

/**
 * Local draft state for the notes editor.
 *
 * The draft is deliberately not read straight from the store on every render:
 * typing would fight the debounced write and reset the caret. Instead the draft
 * is seeded once per project, and an external change (for example "Add to
 * notes" from a chat selection) is adopted only while the editor is untouched
 * since its last save.
 */
export const useProjectNotesDraft = (options: {
  projectRef: ProjectRef | null;
  projectContextId: string;
  storedNotes: string;
  loaded: boolean;
  todos: ProjectTodoItem[];
  persist: (notes: string, todos: ProjectTodoItem[]) => Promise<boolean>;
}) => {
  const { projectRef, projectContextId, storedNotes, loaded, todos, persist } = options;

  const [notes, setNotes] = React.useState('');
  const hydratedRef = React.useRef(false);
  const lastSavedRef = React.useRef('');
  const debounceTimerRef = React.useRef<number | null>(null);

  const cancelDebounce = React.useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // Re-seed when the project changes.
  React.useEffect(() => {
    hydratedRef.current = false;
  }, [projectContextId]);

  React.useEffect(() => {
    if (!projectRef) {
      setNotes('');
      hydratedRef.current = false;
      return;
    }
    if (!loaded) {
      return;
    }

    if (!hydratedRef.current) {
      setNotes(storedNotes);
      lastSavedRef.current = storedNotes;
      hydratedRef.current = true;
      return;
    }

    if (storedNotes === lastSavedRef.current) {
      return;
    }

    // Someone else wrote the notes. Adopt only an untouched editor; otherwise
    // the user is mid-edit and adopting would eat their typing.
    if (notes !== lastSavedRef.current) {
      return;
    }
    lastSavedRef.current = storedNotes;
    setNotes(storedNotes);
  }, [loaded, notes, projectRef, storedNotes]);

  React.useEffect(() => {
    if (!projectRef || !hydratedRef.current) {
      return;
    }
    if (notes === lastSavedRef.current) {
      return;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      lastSavedRef.current = notes;
      void persist(notes, todos);
    }, NOTES_SAVE_DEBOUNCE_MS);

    return cancelDebounce;
  }, [cancelDebounce, notes, persist, projectRef, todos]);

  React.useEffect(() => cancelDebounce, [cancelDebounce]);

  const handleNotesBlur = React.useCallback(() => {
    cancelDebounce();
    lastSavedRef.current = notes;
    void persist(notes, todos);
  }, [cancelDebounce, notes, persist, todos]);

  return { notes, setNotes, handleNotesBlur };
};
