/**
 * The memory index a session is given.
 *
 * Titles only, never bodies. An index that carries the full text grows without
 * bound until it crowds out the conversation it was meant to inform; the agent
 * reads an entry with `openchamber_memory` once a title looks relevant.
 *
 * Sent when the stored set changes rather than on every turn, exactly like
 * pinned context: the conversation already holds what was sent before, so
 * re-sending an unchanged index each turn is pure cost. A memory saved
 * mid-conversation changes the signature and the index goes again, which is
 * what lets the agent see what it just learned.
 */

import type { AgentMemoryEntry } from './agentMemoryApi';

interface MemoryIndexSelection {
  global: AgentMemoryEntry[];
  project: AgentMemoryEntry[];
}

/**
 * Identity of the indexed set, including revisions, so an edited memory
 * re-sends the index rather than leaving the session with a stale title.
 */
export const buildMemoryIndexSignature = (selection: MemoryIndexSelection): string => {
  const entries = [
    ...selection.global.map((entry) => `g:${entry.id}:${entry.updatedAt}`),
    ...selection.project.map((entry) => `p:${entry.id}:${entry.updatedAt}`),
  ];
  return entries.length === 0 ? '' : entries.sort().join('|');
};

const renderSection = (entries: AgentMemoryEntry[]): string => entries
  .slice()
  .sort((a, b) => a.createdAt - b.createdAt)
  .map((entry) => `- [${entry.type}] ${entry.title}`)
  .join('\n');

export const buildMemoryIndexText = (selection: MemoryIndexSelection): string => {
  const sections: string[] = [];
  if (selection.global.length > 0) {
    sections.push(`### About the user\n\n${renderSection(selection.global)}`);
  }
  if (selection.project.length > 0) {
    sections.push(`### About this project\n\n${renderSection(selection.project)}`);
  }
  if (sections.length === 0) {
    return '';
  }

  return [
    'You have stored memory from earlier sessions. Only the titles are listed below.',
    // The failure this exists to prevent: a title reads as a complete fact, so
    // the entry is never opened. "Prefers Ukrainian" sounds self-explanatory
    // and silently drops the condition that decides how to apply it.
    'A title is an abbreviation, not the memory. Read the entry with the'
      + ' openchamber_memory tool before you act on it: titles routinely leave out'
      + ' the conditions, exceptions and reasons that decide how the memory'
      + ' applies, and a title that looks self-explanatory is the most likely to'
      + ' be hiding them. Read every title that could bear on the task at hand;'
      + ' you need not read the ones unrelated to what you are doing.',
    // Stated every time on purpose: memory is the one context the agent has no
    // way to date-check, and acting on a stale note is the failure that costs
    // the user most.
    'Memory records what was true when it was written. Verify anything it says'
      + ' about files, flags or commands before relying on it.',
    ...sections,
  ].join('\n\n');
};

/**
 * Per-session record of the last signature actually sent. Module-scoped so it
 * survives component remounts.
 */
const sentSignatureBySession = new Map<string, string>();

export const shouldSendMemoryIndex = (sessionId: string, signature: string): boolean => (
  Boolean(signature) && sentSignatureBySession.get(sessionId) !== signature
);

export const markMemoryIndexSent = (sessionId: string, signature: string): void => {
  sentSignatureBySession.set(sessionId, signature);
};

export const forgetMemoryIndexForSession = (sessionId: string): void => {
  sentSignatureBySession.delete(sessionId);
};

export const resetMemoryIndexTracking = (): void => {
  sentSignatureBySession.clear();
};

/**
 * Resolve the index block for a send, or `null` when there is nothing new.
 *
 * The snapshot is supplied by the caller rather than fetched here, so a send
 * never waits on a memory request: a slow or unreachable store must delay no
 * message, and the next turn carries the index instead. A scope that failed to
 * load is left out entirely — indexing half the memory as if it were all of it
 * would teach the agent to re-learn what it already knows.
 */
export const resolveMemoryIndexPart = (options: {
  sessionId: string;
  snapshot: {
    global: AgentMemoryEntry[];
    project: AgentMemoryEntry[];
    globalFailed: boolean;
    projectFailed: boolean;
  } | null;
}): { text: string; signature: string; sessionId: string } | null => {
  const { sessionId, snapshot } = options;
  if (!sessionId || !snapshot || snapshot.globalFailed || snapshot.projectFailed) {
    return null;
  }

  const selection = { global: snapshot.global, project: snapshot.project };
  const signature = buildMemoryIndexSignature(selection);
  if (!shouldSendMemoryIndex(sessionId, signature)) {
    return null;
  }

  const text = buildMemoryIndexText(selection);
  if (!text) {
    return null;
  }
  return { text, signature, sessionId };
};
