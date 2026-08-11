import React from 'react';

import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n';
import { PROJECT_NOTES_MAX_LENGTH, type ProjectRef } from '@/lib/projectContextApi';
import { useUIStore } from '@/stores/useUIStore';

/**
 * Free-form project notes.
 *
 * Presentational: the draft value, its debounce, and its persistence live in
 * `useProjectNotesDraft` on the container, because a todo write has to persist
 * the current notes alongside it.
 */
export const NotesSection: React.FC<{
  projectRef: ProjectRef;
  projectLabel?: string | null;
  notes: string;
  onNotesChange: (value: string) => void;
  onNotesBlur: () => void;
  disabled: boolean;
}> = ({ projectRef, projectLabel, notes, onNotesChange, onNotesBlur, disabled }) => {
  const { t } = useI18n();
  const notesPanelHeight = useUIStore((state) => state.notesPanelHeight);
  const setNotesPanelHeight = useUIStore((state) => state.setNotesPanelHeight);

  const title = projectLabel?.trim()
    || projectRef.path.split('/').filter(Boolean).pop()
    || projectRef.path;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate typography-ui-label font-semibold text-foreground" title={projectRef.path}>
          {t('rightSidebar.contextNotesTodo.notes.title', { project: title })}
        </h3>
        <span className="typography-meta text-muted-foreground">{notes.length}/{PROJECT_NOTES_MAX_LENGTH}</span>
      </div>
      <Textarea
        value={notes}
        onChange={(event) => onNotesChange(event.target.value.slice(0, PROJECT_NOTES_MAX_LENGTH))}
        onBlur={onNotesBlur}
        placeholder={t('rightSidebar.contextNotesTodo.notes.placeholder')}
        resizedHeight={notesPanelHeight}
        onResizeHeightChange={setNotesPanelHeight}
        useScrollShadow
        scrollShadowSize={56}
        disabled={disabled}
      />
    </div>
  );
};
