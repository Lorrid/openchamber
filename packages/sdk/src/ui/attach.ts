import { mountIssueChrome } from './chrome.ts';
import type { AttachIssuesHandle, AttachIssuesProps } from './types.ts';

/** GitHub / Linear attach picker. Search stays open. Filters are optional. */
export const mountAttachIssues = (root: Element, initial: AttachIssuesProps): AttachIssuesHandle => (
  mountIssueChrome(root, initial, 'picker')
);
