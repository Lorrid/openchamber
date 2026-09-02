import { mountIssueChrome } from './chrome.ts';
import type { IssuePageHandle, IssuePageProps } from './types.ts';

/** Task page with compact filters. Same chrome Linear uses on the rail. Jira and ClickUp pass the same rows. */
export const mountIssuePage = (root: Element, initial: IssuePageProps): IssuePageHandle => (
  mountIssueChrome(root, initial, 'page')
);
