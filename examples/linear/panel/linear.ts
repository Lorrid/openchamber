import { z } from 'zod';

import type { GuestRequest } from '@openchamber/sdk';
import type { IssueCardComment, IssueFilter, IssueTask } from '@openchamber/sdk/ui';

export type LinearTransport = {
  request: (request: GuestRequest) => Promise<{ status: number; body: string }>;
};

const PRIORITY_LABEL = {
  0: '',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
} as const;

const actorSchema = z.object({
  name: z.string().nullish().transform((value) => value ?? ''),
  displayName: z.string().nullish().transform((value) => value ?? ''),
}).nullish();

const issueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  url: z.string().optional().default(''),
  priority: z.number().optional().default(0),
  description: z.string().nullish().transform((value) => value ?? ''),
  state: z.object({
    name: z.string(),
  }).nullish(),
  assignee: actorSchema,
  team: z.object({
    key: z.string().nullish().transform((value) => value ?? ''),
    name: z.string().nullish().transform((value) => value ?? ''),
  }).nullish(),
});

const commentSchema = z.object({
  id: z.string(),
  body: z.string().nullish().transform((value) => value ?? ''),
  createdAt: z.string().nullish(),
  user: actorSchema,
});

const listSchema = z.object({
  data: z.object({
    issues: z.object({
      nodes: z.array(z.unknown()).optional().default([]),
    }),
  }),
});

const detailSchema = z.object({
  data: z.object({
    issue: issueSchema.extend({
      comments: z.object({
        nodes: z.array(z.unknown()).optional().default([]),
      }).optional(),
    }),
  }),
});

const hostGetSchema = z.object({
  connected: z.boolean(),
  issue: issueSchema.extend({
    comments: z.array(z.unknown()).optional().default([]),
  }).nullish(),
});

type LinearIssue = z.infer<typeof issueSchema>;
type LinearComment = z.infer<typeof commentSchema>;

export type LinearRow = {
  item: IssueTask;
  description: string;
};

export const LIST_QUERY = `query GuestLinearIssues($first: Int!) {
  issues(first: $first, orderBy: updatedAt) {
    nodes {
      id identifier title url priority
      state { name }
      assignee { name displayName }
      team { key name }
    }
  }
}`;

export const linearGraphqlPath = (): string => '/graphql';

export const linearIssueGetPath = (): string => '/api/linear/issues/get';

export const linearListBody = (first = 50): string => JSON.stringify({
  query: LIST_QUERY,
  variables: { first },
});

export const actorLabel = (actor: LinearIssue['assignee']): string => {
  const display = actor?.displayName.trim() ?? '';
  if (display) return display;
  return actor?.name.trim() ?? '';
};

export const priorityLabel = (priority: number): string => {
  if (priority === 1) return PRIORITY_LABEL[1];
  if (priority === 2) return PRIORITY_LABEL[2];
  if (priority === 3) return PRIORITY_LABEL[3];
  if (priority === 4) return PRIORITY_LABEL[4];
  return '';
};

const LINEAR_UPLOAD_LINK = /(?<!!)\[([^\]]*)\]\((https:\/\/uploads\.linear\.app\/[^)\s]+)\)/g;

export const liftLinearUploadLinks = (text: string): string => (
  text.replace(LINEAR_UPLOAD_LINK, '![$1]($2)')
);

export const mapLinearIssue = (issue: LinearIssue): LinearRow | null => {
  const id = issue.id.trim();
  const title = issue.title.trim();
  if (!id || !title) {
    return null;
  }
  const priority = priorityLabel(issue.priority);
  const team = issue.team?.key.trim() || issue.team?.name.trim() || '';
  const item: IssueTask = {
    id,
    title,
    identifier: issue.identifier,
    url: issue.url || undefined,
    status: issue.state?.name,
    assignee: actorLabel(issue.assignee) || undefined,
    team: team || undefined,
  };
  if (priority) {
    item.priority = priority;
  }
  return {
    item,
    description: liftLinearUploadLinks(issue.description),
  };
};

export const mapLinearComment = (comment: LinearComment): IssueCardComment | null => {
  const id = comment.id.trim();
  const body = comment.body.trim();
  if (!id || !body) {
    return null;
  }
  return {
    id,
    body: liftLinearUploadLinks(body),
    author: actorLabel(comment.user),
    createdAt: comment.createdAt ?? undefined,
  };
};

const graphql = async (transport: LinearTransport, body: string): Promise<string> => {
  const result = await transport.request({
    method: 'POST',
    path: linearGraphqlPath(),
    body,
  });
  if (result.status >= 400) {
    throw new Error(`Linear ${result.status}`);
  }
  return result.body;
};

export const rowsFromListJson = (text: string): LinearRow[] => {
  const parsed = listSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    return [];
  }
  const rows: LinearRow[] = [];
  for (const node of parsed.data.data.issues.nodes) {
    const issue = issueSchema.safeParse(node);
    if (!issue.success) {
      continue;
    }
    const mapped = mapLinearIssue(issue.data);
    if (mapped) {
      rows.push(mapped);
    }
  }
  return rows;
};

const commentsFromNodes = (nodes: readonly unknown[]): IssueCardComment[] => {
  const comments: IssueCardComment[] = [];
  for (const node of nodes) {
    const comment = commentSchema.safeParse(node);
    if (!comment.success) {
      continue;
    }
    const mapped = mapLinearComment(comment.data);
    if (mapped) {
      comments.push(mapped);
    }
  }
  return comments;
};

export const detailFromJson = (text: string): { row: LinearRow; comments: IssueCardComment[] } | null => {
  const parsed = detailSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    return null;
  }
  const row = mapLinearIssue(parsed.data.data.issue);
  if (!row) {
    return null;
  }
  return { row, comments: commentsFromNodes(parsed.data.data.issue.comments?.nodes ?? []) };
};

export const detailFromHostJson = (text: string): { row: LinearRow; comments: IssueCardComment[] } | null => {
  const parsed = hostGetSchema.safeParse(JSON.parse(text));
  if (!parsed.success || !parsed.data.connected || !parsed.data.issue) {
    return null;
  }
  const row = mapLinearIssue(parsed.data.issue);
  if (!row) {
    return null;
  }
  return { row, comments: commentsFromNodes(parsed.data.issue.comments) };
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

const allFilter = (
  id: IssueFilter['id'],
  label: string,
  field: IssueFilter['field'],
  options: { id: string; label: string }[],
  slot: IssueFilter['slot'],
  allLabel: string,
): IssueFilter | null => {
  if (options.length === 0) {
    return null;
  }
  return {
    id,
    label,
    field,
    slot,
    value: 'all',
    options: [{ id: 'all', label: allLabel }, ...options],
  };
};

const chosenValue = (
  options: readonly { id: string }[],
  chosen: string | undefined,
): string => {
  if (chosen && options.some((option) => option.id === chosen)) {
    return chosen;
  }
  return 'all';
};

export const buildLinearFilters = (
  items: readonly IssueTask[],
  values: Readonly<Record<string, string>> = {},
): IssueFilter[] => {
  const filters: IssueFilter[] = [];
  const statusOptions = uniqueOptions(items.map((item) => item.status));
  const priorityOptions = uniqueOptions(items.map((item) => item.priority));
  const assigneeOptions = uniqueOptions(items.map((item) => item.assignee));
  const teamOptions = uniqueOptions(items.map((item) => item.team));
  const status = allFilter('status', 'Status', 'status', statusOptions, 'start', 'All');
  const priority = allFilter('priority', 'Priority', 'priority', priorityOptions, 'end', 'All');
  const assignee = allFilter('assignee', 'Assignee', 'assignee', assigneeOptions, 'end', 'Any');
  const team = allFilter('team', 'Team', 'team', teamOptions, 'end', 'All');
  if (status) {
    status.value = chosenValue(status.options, values.status);
    filters.push(status);
  }
  if (priority) {
    priority.value = chosenValue(priority.options, values.priority);
    filters.push(priority);
  }
  if (assignee) {
    assignee.value = chosenValue(assignee.options, values.assignee);
    filters.push(assignee);
  }
  if (team) {
    team.value = chosenValue(team.options, values.team);
    filters.push(team);
  }
  return filters;
};

export const loadLinearList = async (transport: LinearTransport): Promise<LinearRow[]> => {
  return rowsFromListJson(await graphql(transport, linearListBody()));
};

export const getLinearIssue = async (
  transport: LinearTransport,
  id: string,
): Promise<{ row: LinearRow; comments: IssueCardComment[] } | null> => {
  const result = await transport.request({
    method: 'GET',
    path: linearIssueGetPath(),
    query: { id },
  });
  if (result.status >= 400) {
    throw new Error(`Linear ${result.status}`);
  }
  return detailFromHostJson(result.body);
};
