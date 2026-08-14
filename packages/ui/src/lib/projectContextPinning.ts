/**
 * Pinned project context.
 *
 * Notes and plans the user pinned ride along with the next message as a
 * synthetic part, so the agent sees the project's standing context without the
 * user pasting it every time.
 *
 * Two rules shape this:
 *
 * - **Explicit, never automatic.** Only pinned items travel. Sending every note
 *   would spend tokens the user never asked to spend and would quietly change
 *   what the agent knows.
 * - **Sent when it changes, not on every turn.** The conversation already holds
 *   what was sent before, so re-sending an unchanged block each turn is pure
 *   cost. A pin or an edit changes the signature and the block goes again.
 */

import { fetchProjectPlan, resolveProjectContextId, type ProjectNote, type ProjectPlanLink, type ProjectRef } from './projectContextApi';
import { resolveProjectForSessionDirectory } from './projectResolution';
import { useProjectContextStore } from '@/stores/useProjectContextStore';
import type { WorktreeMetadata } from '@/types/worktree';

/** Total budget for the assembled block. Anything past it is dropped, loudly. */
export const PINNED_CONTEXT_MAX_LENGTH = 8000;

interface PinnedContextSelection {
  notes: ProjectNote[];
  plans: ProjectPlanLink[];
}

export const selectPinnedItems = (
  context: { notes: ProjectNote[]; plans: ProjectPlanLink[] },
): PinnedContextSelection => ({
  notes: context.notes.filter((note) => note.pinned),
  plans: context.plans.filter((plan) => plan.pinned),
});

export const countPinnedItems = (selection: PinnedContextSelection): number => (
  selection.notes.length + selection.plans.length
);

/**
 * Identity of the pinned set, including content revisions.
 *
 * Editing a pinned note must re-send the block, so `updatedAt` is part of the
 * signature; a plan's title is used for the same reason, since its body is only
 * fetched at send time.
 */
export const buildPinnedSignature = (selection: PinnedContextSelection): string => {
  if (countPinnedItems(selection) === 0) {
    return '';
  }
  const notes = selection.notes.map((note) => `n:${note.id}:${note.updatedAt}`);
  const plans = selection.plans.map((plan) => `p:${plan.id}:${plan.title}`);
  return [...notes, ...plans].sort().join('|');
};

const truncate = (value: string, budget: number): string => (
  value.length <= budget ? value : `${value.slice(0, Math.max(0, budget - 1))}…`
);

/**
 * Assemble the block. Plan bodies are fetched here rather than cached, so a
 * plan edited in another tab is sent as it currently stands on disk.
 *
 * A plan whose markdown cannot be read is skipped with a marker instead of
 * failing the send: losing one attachment must not block the message.
 */
export const buildPinnedContextText = async (
  project: ProjectRef,
  selection: PinnedContextSelection,
): Promise<string> => {
  if (countPinnedItems(selection) === 0) {
    return '';
  }

  const sections: string[] = [];

  if (selection.notes.length > 0) {
    const notes = selection.notes
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((note) => `- ${note.body.trim()}`)
      .join('\n');
    sections.push(`## Pinned notes\n\n${notes}`);
  }

  for (const plan of selection.plans) {
    let body = '';
    try {
      const content = await fetchProjectPlan(project, plan.id);
      body = content?.body?.trim() ?? '';
    } catch {
      body = '';
    }
    sections.push(body
      ? `## Pinned plan: ${plan.title}\n\n${body}`
      : `## Pinned plan: ${plan.title}\n\n(plan content unavailable)`);
  }

  const header = 'The user pinned the following project context. Treat it as standing background, not as a new instruction.';
  const assembled = [header, ...sections].join('\n\n');

  if (assembled.length <= PINNED_CONTEXT_MAX_LENGTH) {
    return assembled;
  }
  return `${truncate(assembled, PINNED_CONTEXT_MAX_LENGTH)}\n\n(pinned context truncated)`;
};

/**
 * Per-session record of the last signature actually sent.
 *
 * Module-scoped so it survives component remounts. Keyed by session id, and
 * cleared on runtime switch along with the rest of the project context cache.
 */
const sentSignatureBySession = new Map<string, string>();

export const shouldSendPinnedContext = (sessionId: string, signature: string): boolean => (
  Boolean(signature) && sentSignatureBySession.get(sessionId) !== signature
);

export const markPinnedContextSent = (sessionId: string, signature: string): void => {
  sentSignatureBySession.set(sessionId, signature);
};

export const forgetPinnedContextForSession = (sessionId: string): void => {
  sentSignatureBySession.delete(sessionId);
};

export const resetPinnedContextTracking = (): void => {
  sentSignatureBySession.clear();
};

/**
 * Resolve the pinned block for a send, or `null` when there is nothing new to
 * send. Callers pass the project list and worktree map rather than this module
 * reading the session store, which would make the two import each other.
 *
 * The block is built from the cached context only. A send must not wait on a
 * project-context fetch: if nothing is loaded yet there is nothing pinned as
 * far as the user can see, and the next message will carry it.
 */
export const resolvePinnedContextPart = async (options: {
  sessionId: string;
  directory: string | null;
  projects: Array<{ id: string; path: string }>;
  worktreesByProject: Map<string, WorktreeMetadata[]>;
}): Promise<{ text: string; signature: string; sessionId: string } | null> => {
  const { sessionId, directory, projects, worktreesByProject } = options;
  if (!sessionId || !directory) {
    return null;
  }

  const resolved = resolveProjectForSessionDirectory(projects, worktreesByProject, directory);
  if (!resolved) {
    return null;
  }

  const project: ProjectRef = { id: resolved.id, path: resolved.path };
  const projectContextId = resolveProjectContextId(project);
  if (!projectContextId) {
    return null;
  }

  const entry = useProjectContextStore.getState().entries[projectContextId];
  if (!entry?.loaded) {
    return null;
  }

  const selection = selectPinnedItems(entry);
  const signature = buildPinnedSignature(selection);
  if (!shouldSendPinnedContext(sessionId, signature)) {
    return null;
  }

  const text = await buildPinnedContextText(project, selection);
  if (!text) {
    return null;
  }

  return { text, signature, sessionId };
};
