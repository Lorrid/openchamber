import { z } from 'zod';

import type { GuestRequest } from '@openchamber/sdk';
import type {
  IssueCardChip,
  IssueCardComment,
  IssueFilter,
  IssueTask,
  PullRequestCheck,
  PullRequestRecord,
  PullRequestState,
} from '@openchamber/sdk/ui';

export type GitlabTransport = {
  request: (request: GuestRequest) => Promise<{ status: number; body: string }>;
};

const textField = z.union([z.string(), z.number()]).transform((value) => String(value));

const blankText = z.string().nullish().transform((value) => value ?? '');

const userSchema = z.object({
  username: z.string().optional().default(''),
});

const issueSchema = z.object({
  id: textField,
  iid: textField,
  title: z.string(),
  web_url: blankText,
  state: z.string().optional().default(''),
  description: blankText,
  labels: z.array(z.string()).optional().default([]),
  assignees: z.array(userSchema).optional().default([]),
  author: userSchema.optional(),
});

const mergeRequestSchema = z.object({
  id: textField,
  iid: textField,
  title: z.string(),
  web_url: blankText,
  state: z.string().optional().default(''),
  description: blankText,
  labels: z.array(z.string()).optional().default([]),
  assignees: z.array(userSchema).optional().default([]),
  author: userSchema.optional(),
  source_branch: blankText,
  target_branch: blankText,
  draft: z.boolean().optional().default(false),
  merge_status: blankText,
  detailed_merge_status: blankText,
});

const pipelineSchema = z.object({
  id: textField,
  status: z.string().optional().default(''),
  name: blankText,
  web_url: blankText,
});

const changeSchema = z.object({
  old_path: blankText,
  new_path: blankText,
  diff: blankText,
});

const changesSchema = z.object({
  changes: z.array(changeSchema).optional().default([]),
});

const noteSchema = z.object({
  id: textField,
  body: blankText,
  created_at: blankText,
  system: z.boolean().optional().default(false),
  author: userSchema.optional(),
});

type GitlabIssue = z.infer<typeof issueSchema>;
type GitlabMergeRequest = z.infer<typeof mergeRequestSchema>;
type GitlabNote = z.infer<typeof noteSchema>;
type GitlabPipeline = z.infer<typeof pipelineSchema>;

export type GitlabRow = {
  item: IssueTask;
  description: string;
  tags: IssueCardChip[];
  thread: 'issue' | 'pull';
  author?: string;
  branches?: { head: string; base: string };
};

export type GitlabDetail = GitlabRow & {
  comments: IssueCardComment[];
};

export type GitlabPullDetail = GitlabRow & {
  pull: PullRequestRecord;
  checks: PullRequestCheck[];
  comments: IssueCardComment[];
};

export const encodeGitlabProject = (projectPath: string): string => (
  encodeURIComponent(projectPath.trim())
);

export const gitlabIssuesPath = (projectPath: string): string => (
  `/api/v4/projects/${encodeGitlabProject(projectPath)}/issues`
);

export const gitlabIssuePath = (projectPath: string, iid: string): string => (
  `${gitlabIssuesPath(projectPath)}/${encodeURIComponent(iid)}`
);

export const gitlabIssueNotesPath = (projectPath: string, iid: string): string => (
  `${gitlabIssuePath(projectPath, iid)}/notes`
);

export const gitlabMergeRequestsPath = (projectPath: string): string => (
  `/api/v4/projects/${encodeGitlabProject(projectPath)}/merge_requests`
);

export const gitlabMergeRequestPath = (projectPath: string, iid: string): string => (
  `${gitlabMergeRequestsPath(projectPath)}/${encodeURIComponent(iid.replace(/^!/, ''))}`
);

export const gitlabMergeRequestChangesPath = (projectPath: string, iid: string): string => (
  `${gitlabMergeRequestPath(projectPath, iid)}/changes`
);

export const gitlabMergeRequestNotesPath = (projectPath: string, iid: string): string => (
  `${gitlabMergeRequestPath(projectPath, iid)}/notes`
);

export const gitlabMergeRequestPipelinesPath = (projectPath: string, iid: string): string => (
  `${gitlabMergeRequestPath(projectPath, iid)}/pipelines`
);

export const gitlabMergeRequestMergePath = (projectPath: string, iid: string): string => (
  `${gitlabMergeRequestPath(projectPath, iid)}/merge`
);

export const gitlabMergeRequestRebasePath = (projectPath: string, iid: string): string => (
  `${gitlabMergeRequestPath(projectPath, iid)}/rebase`
);

const withBadge = (item: IssueTask, projectPath: string): IssueTask => {
  const badge = projectPath.trim();
  if (!badge) {
    return item;
  }
  return { ...item, badge };
};

export const mapGitlabIssue = (raw: GitlabIssue, projectPath = ''): GitlabRow | null => {
  if (raw.iid === '' || raw.title === '') {
    return null;
  }
  const assignee = raw.assignees.find((entry) => entry.username !== '');
  const author = raw.author?.username.trim();
  return {
    item: withBadge({
      id: raw.iid,
      title: raw.title,
      identifier: `#${raw.iid}`,
      url: raw.web_url || undefined,
    status: raw.state || undefined,
    assignee: assignee?.username,
    team: 'Issue',
  }, projectPath),
    description: raw.description,
    tags: raw.labels.map((label) => ({ id: label, name: label })),
    thread: 'issue',
    author: author || undefined,
  };
};

export const mapGitlabMergeRequest = (raw: GitlabMergeRequest, projectPath = ''): GitlabRow | null => {
  if (raw.iid === '' || raw.title === '') {
    return null;
  }
  const assignee = raw.assignees.find((entry) => entry.username !== '');
  const author = raw.author?.username.trim();
  const head = raw.source_branch.trim();
  const base = raw.target_branch.trim();
  const item: IssueTask = withBadge({
    id: `!${raw.iid}`,
    title: raw.title,
    identifier: `!${raw.iid}`,
    url: raw.web_url || undefined,
    status: raw.state || undefined,
    assignee: assignee?.username,
    team: 'Merge request',
    subtitle: head && base ? `${head} → ${base}` : undefined,
  }, projectPath);
  const next: GitlabRow = {
    item,
    description: raw.description,
    tags: raw.labels.map((label) => ({ id: label, name: label })),
    thread: 'pull',
    author: author || undefined,
  };
  if (head && base) {
    next.branches = { head, base };
  }
  return next;
};

export const mapGitlabNote = (raw: GitlabNote): IssueCardComment | null => {
  if (raw.id === '' || raw.system || raw.body === '') {
    return null;
  }
  const when = raw.created_at ? raw.created_at.slice(0, 10) : '';
  return {
    id: raw.id,
    author: raw.author?.username || 'GitLab',
    body: raw.body,
    createdAt: when || undefined,
  };
};

export const buildGitlabFilters = (items: readonly IssueTask[]): IssueFilter[] => {
  const status = uniqueOptions(['opened', 'closed', ...items.map((item) => item.status)]);
  const assignee = uniqueOptions(items.map((item) => item.assignee));
  const filters: IssueFilter[] = [];
  if (status.length > 0) {
    filters.push({
      id: 'status',
      label: 'Status',
      field: 'status',
      slot: 'start',
      value: 'all',
      options: [{ id: 'all', label: 'All' }, ...status],
    });
  }
  if (assignee.length > 0) {
    filters.push({
      id: 'assignee',
      label: 'Assignee',
      field: 'assignee',
      slot: 'end',
      value: 'all',
      options: [{ id: 'all', label: 'Any' }, ...assignee],
    });
  }
  const team = uniqueOptions(items.map((item) => item.team));
  if (team.length > 1) {
    filters.push({
      id: 'team',
      label: 'Type',
      field: 'team',
      slot: 'end',
      value: 'all',
      options: [{ id: 'all', label: 'All' }, ...team],
    });
  }
  return filters;
};

export const gitlabPullState = (raw: GitlabMergeRequest): PullRequestState => {
  if (raw.state === 'merged') {
    return 'merged';
  }
  if (raw.state === 'closed') {
    return 'closed';
  }
  if (raw.draft) {
    return 'draft';
  }
  return 'open';
};

export const gitlabPullMergeable = (raw: GitlabMergeRequest): boolean | undefined => {
  if (raw.detailed_merge_status === 'mergeable' || raw.merge_status === 'can_be_merged') {
    return true;
  }
  if (raw.detailed_merge_status !== '' || raw.merge_status !== '') {
    return false;
  }
  return undefined;
};

export const mapGitlabPull = (raw: GitlabMergeRequest, projectPath = ''): PullRequestRecord | null => {
  const row = mapGitlabMergeRequest(raw, projectPath);
  if (!row) {
    return null;
  }
  const next: PullRequestRecord = {
    id: row.item.id,
    title: row.item.title,
    state: gitlabPullState(raw),
    body: raw.description,
    mergeable: gitlabPullMergeable(raw),
  };
  if (row.item.url) {
    next.url = row.item.url;
  }
  if (row.author) {
    next.author = row.author;
  }
  if (row.branches) {
    next.head = row.branches.head;
    next.base = row.branches.base;
  }
  return next;
};

const pipelineCheckState = (status: string): PullRequestCheck['state'] => {
  if (status === 'success') {
    return 'success';
  }
  if (status === 'failed' || status === 'canceled') {
    return 'failure';
  }
  if (status === 'running') {
    return 'running';
  }
  if (status === 'pending' || status === 'created' || status === 'waiting_for_resource' || status === 'preparing') {
    return 'pending';
  }
  return 'queued';
};

export const mapGitlabPipeline = (raw: GitlabPipeline): PullRequestCheck | null => {
  if (raw.id === '') {
    return null;
  }
  const next: PullRequestCheck = {
    id: raw.id,
    name: raw.name || `Pipeline ${raw.id}`,
    state: pipelineCheckState(raw.status),
  };
  if (raw.web_url) {
    next.detail = raw.web_url;
  }
  return next;
};

const uniqueOptions = (
  values: readonly (string | undefined)[],
): { id: string; label: string }[] => {
  const seen = new Set<string>();
  const options: { id: string; label: string }[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push({ id: value, label: value });
  }
  return options;
};

const gitlabGet = async (
  transport: GitlabTransport,
  path: string,
  query?: Record<string, string>,
): Promise<string> => {
  const request: GuestRequest = { method: 'GET', path };
  if (query) {
    request.query = query;
  }
  const result = await transport.request(request);
  if (result.status >= 400) {
    throw new Error(`GitLab ${result.status}`);
  }
  return result.body;
};

export const gitlabStateBody = (status: string): string | null => {
  if (status === 'opened') {
    return JSON.stringify({ state_event: 'reopen' });
  }
  if (status === 'closed') {
    return JSON.stringify({ state_event: 'close' });
  }
  return null;
};

export const setGitlabState = async (
  transport: GitlabTransport,
  projectPath: string,
  iid: string,
  status: string,
): Promise<void> => {
  const body = gitlabStateBody(status);
  if (!body) {
    throw new Error('GitLab state is empty');
  }
  const result = await transport.request({
    method: 'PUT',
    path: gitlabIssuePath(projectPath, iid),
    body,
  });
  if (result.status >= 400) {
    throw new Error(`GitLab ${result.status}`);
  }
};

const parseIssueArray = (text: string): GitlabIssue[] => {
  const parsed = z.array(issueSchema).safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : [];
};

const parseNoteArray = (text: string): GitlabNote[] => {
  const parsed = z.array(noteSchema).safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : [];
};

const parseIssue = (text: string): GitlabIssue | null => {
  const parsed = issueSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
};

export const GITLAB_ISSUE_PAGE = 100;

export const hasMoreGitlabPages = (pageCount: number): boolean => pageCount >= GITLAB_ISSUE_PAGE;

const parseMergeRequestArray = (text: string): GitlabMergeRequest[] => {
  const parsed = z.array(mergeRequestSchema).safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : [];
};

export const rowsFromIssuesJson = (text: string, projectPath = ''): GitlabRow[] => {
  const rows: GitlabRow[] = [];
  for (const issue of parseIssueArray(text)) {
    const mapped = mapGitlabIssue(issue, projectPath);
    if (mapped) {
      rows.push(mapped);
    }
  }
  return rows;
};

export const rowsFromMergeRequestsJson = (text: string, projectPath = ''): GitlabRow[] => {
  const rows: GitlabRow[] = [];
  for (const mergeRequest of parseMergeRequestArray(text)) {
    const mapped = mapGitlabMergeRequest(mergeRequest, projectPath);
    if (mapped) {
      rows.push(mapped);
    }
  }
  return rows;
};

export const detailFromBodies = (issueText: string, notesText: string): GitlabDetail | null => {
  const issue = parseIssue(issueText);
  if (!issue) {
    return null;
  }
  const mapped = mapGitlabIssue(issue);
  if (!mapped) {
    return null;
  }
  const comments: IssueCardComment[] = [];
  for (const note of parseNoteArray(notesText)) {
    const next = mapGitlabNote(note);
    if (next) {
      comments.push(next);
    }
  }
  return { ...mapped, comments };
};

export type GitlabList = {
  rows: GitlabRow[];
  statuses: string[];
};

export const listGitlabIssues = async (
  transport: GitlabTransport,
  projectPath: string,
): Promise<GitlabRow[]> => {
  const rows: GitlabRow[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const next = rowsFromIssuesJson(await gitlabGet(transport, gitlabIssuesPath(projectPath), {
      state: 'all',
      per_page: String(GITLAB_ISSUE_PAGE),
      page: String(page),
    }), projectPath);
    rows.push(...next);
    if (!hasMoreGitlabPages(next.length)) {
      break;
    }
  }
  return rows;
};

export const listGitlabMergeRequests = async (
  transport: GitlabTransport,
  projectPath: string,
): Promise<GitlabRow[]> => {
  const rows: GitlabRow[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const next = rowsFromMergeRequestsJson(await gitlabGet(transport, gitlabMergeRequestsPath(projectPath), {
      state: 'all',
      per_page: String(GITLAB_ISSUE_PAGE),
      page: String(page),
    }), projectPath);
    rows.push(...next);
    if (!hasMoreGitlabPages(next.length)) {
      break;
    }
  }
  return rows;
};

export const loadGitlabList = async (
  transport: GitlabTransport,
  projectPath: string,
): Promise<GitlabList> => {
  const [issues, mergeRequests] = await Promise.all([
    listGitlabIssues(transport, projectPath),
    listGitlabMergeRequests(transport, projectPath),
  ]);
  return {
    rows: [...issues, ...mergeRequests],
    statuses: ['opened', 'closed'],
  };
};

export type GitlabAttachPage = {
  rows: GitlabRow[];
  hasMore: boolean;
};

export const loadGitlabAttachPage = async (
  transport: GitlabTransport,
  projectPath: string,
  page: number,
): Promise<GitlabAttachPage> => {
  const query = {
    state: 'all',
    per_page: String(GITLAB_ISSUE_PAGE),
    page: String(page),
  };
  const [issuesBody, mergeRequestsBody] = await Promise.all([
    gitlabGet(transport, gitlabIssuesPath(projectPath), query),
    gitlabGet(transport, gitlabMergeRequestsPath(projectPath), query),
  ]);
  const issues = rowsFromIssuesJson(issuesBody, projectPath);
  const mergeRequests = rowsFromMergeRequestsJson(mergeRequestsBody, projectPath);
  return {
    rows: [...issues, ...mergeRequests],
    hasMore: hasMoreGitlabPages(issues.length) || hasMoreGitlabPages(mergeRequests.length),
  };
};

export const GITLAB_ATTACH_TEXT_MAX = 16_000;
export const GITLAB_DIFF_FILE_MAX = 20;
export const GITLAB_DIFF_CHUNK_MAX = 4_000;

export const textFromMergeRequestChanges = (text: string): string => {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return '';
  }
  const parsed = changesSchema.safeParse(document);
  if (!parsed.success) {
    return '';
  }
  const chunks: string[] = [];
  for (const change of parsed.data.changes.slice(0, GITLAB_DIFF_FILE_MAX)) {
    const path = change.new_path || change.old_path;
    if (!path || !change.diff) {
      continue;
    }
    chunks.push(`${path}\n${change.diff.slice(0, GITLAB_DIFF_CHUNK_MAX)}`);
  }
  return chunks.join('\n\n').slice(0, GITLAB_ATTACH_TEXT_MAX);
};

export const getGitlabMergeRequestDiff = async (
  transport: GitlabTransport,
  projectPath: string,
  iid: string,
): Promise<string> => (
  textFromMergeRequestChanges(await gitlabGet(transport, gitlabMergeRequestChangesPath(projectPath, iid)))
);

export const getGitlabIssue = async (
  transport: GitlabTransport,
  projectPath: string,
  iid: string,
): Promise<GitlabDetail | null> => {
  const [issueBody, notesBody] = await Promise.all([
    gitlabGet(transport, gitlabIssuePath(projectPath, iid)),
    gitlabGet(transport, gitlabIssueNotesPath(projectPath, iid)),
  ]);
  return detailFromBodies(issueBody, notesBody);
};

const parseMergeRequest = (text: string): GitlabMergeRequest | null => {
  const parsed = mergeRequestSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
};

const parsePipelineArray = (text: string): GitlabPipeline[] => {
  const parsed = z.array(pipelineSchema).safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : [];
};

export const pullDetailFromBodies = (
  mergeRequestText: string,
  notesText: string,
  pipelinesText: string,
  projectPath = '',
): GitlabPullDetail | null => {
  const raw = parseMergeRequest(mergeRequestText);
  if (!raw) {
    return null;
  }
  const row = mapGitlabMergeRequest(raw, projectPath);
  const pull = mapGitlabPull(raw, projectPath);
  if (!row || !pull) {
    return null;
  }
  const comments: IssueCardComment[] = [];
  for (const note of parseNoteArray(notesText)) {
    const next = mapGitlabNote(note);
    if (next) {
      comments.push(next);
    }
  }
  const checks: PullRequestCheck[] = [];
  for (const pipeline of parsePipelineArray(pipelinesText)) {
    const next = mapGitlabPipeline(pipeline);
    if (next) {
      checks.push(next);
    }
  }
  return { ...row, pull, checks, comments };
};

export const getGitlabMergeRequest = async (
  transport: GitlabTransport,
  projectPath: string,
  iid: string,
): Promise<GitlabPullDetail | null> => {
  const [mergeRequestBody, notesBody, pipelinesBody] = await Promise.all([
    gitlabGet(transport, gitlabMergeRequestPath(projectPath, iid)),
    gitlabGet(transport, gitlabMergeRequestNotesPath(projectPath, iid)),
    gitlabGet(transport, gitlabMergeRequestPipelinesPath(projectPath, iid)),
  ]);
  return pullDetailFromBodies(mergeRequestBody, notesBody, pipelinesBody, projectPath);
};

export const gitlabCreateMergeRequestBody = (values: {
  title: string;
  description: string;
  head: string;
  base: string;
  draft: boolean;
}): string => JSON.stringify({
  title: values.title,
  description: values.description,
  source_branch: values.head,
  target_branch: values.base,
  draft: values.draft,
});

export const gitlabMergeBody = (method: 'squash' | 'merge'): string => (
  JSON.stringify({ squash: method === 'squash' })
);

export const writeGitlabMergeRequest = async (
  transport: GitlabTransport,
  projectPath: string,
  iid: string,
  body: string,
): Promise<void> => {
  const result = await transport.request({
    method: 'PUT',
    path: gitlabMergeRequestPath(projectPath, iid),
    body,
  });
  if (result.status >= 400) {
    throw new Error(`GitLab ${result.status}`);
  }
};

export const createGitlabMergeRequest = async (
  transport: GitlabTransport,
  projectPath: string,
  values: {
    title: string;
    description: string;
    head: string;
    base: string;
    draft: boolean;
  },
): Promise<GitlabPullDetail | null> => {
  const result = await transport.request({
    method: 'POST',
    path: gitlabMergeRequestsPath(projectPath),
    body: gitlabCreateMergeRequestBody(values),
  });
  if (result.status >= 400) {
    throw new Error(`GitLab ${result.status}`);
  }
  const created = parseMergeRequest(result.body);
  if (!created) {
    return null;
  }
  return getGitlabMergeRequest(transport, projectPath, created.iid);
};

export const mergeGitlabMergeRequest = async (
  transport: GitlabTransport,
  projectPath: string,
  iid: string,
  method: 'squash' | 'merge' | 'rebase',
): Promise<void> => {
  const path = method === 'rebase'
    ? gitlabMergeRequestRebasePath(projectPath, iid)
    : gitlabMergeRequestMergePath(projectPath, iid);
  const request = method === 'rebase'
    ? { method: 'PUT' as const, path }
    : { method: 'PUT' as const, path, body: gitlabMergeBody(method) };
  const result = await transport.request(request);
  if (result.status >= 400) {
    throw new Error(`GitLab ${result.status}`);
  }
};
