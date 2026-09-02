import { z } from 'zod';

import type { GuestRequest } from '@openchamber/sdk';
import type { IssueCardChip, IssueCardComment, IssueFilter, IssueTask } from '@openchamber/sdk/ui';

export type ClickupTransport = {
  request: (request: GuestRequest) => Promise<{ status: number; body: string }>;
};

const PRIORITY_LABEL = {
  '1': 'Urgent',
  '2': 'High',
  '3': 'Normal',
  '4': 'Low',
} as const;

const textField = z.union([z.string(), z.number()]).transform((value) => String(value));

const blankText = z.string().nullish().transform((value) => value ?? '');

const statusField = z.union([
  z.string(),
  z.object({ status: z.string() }).transform((value) => value.status),
]).optional().default('');

const priorityField = z.union([
  z.string(),
  z.object({ id: textField }).transform((value) => value.id),
  z.null(),
]).optional();

const assigneeSchema = z.object({
  id: textField.optional().default(''),
  username: z.string().optional().default(''),
});

const tagSchema = z.object({
  name: z.string(),
});

const taskSchema = z.object({
  id: textField,
  name: z.string(),
  custom_id: blankText,
  url: blankText,
  status: statusField,
  assignees: z.array(assigneeSchema).optional().default([]),
  priority: priorityField,
  tags: z.array(tagSchema).optional().default([]),
  text_content: blankText,
});

const commentSchema = z.object({
  id: textField,
  comment_text: blankText,
  date: z.union([z.number(), z.string()]).optional(),
  user: z.object({
    username: z.string().optional().default(''),
  }).optional(),
});

const listSchema = z.object({
  statuses: z.array(z.object({
    status: z.string(),
    orderindex: z.union([z.string(), z.number()]).optional(),
  })).optional().default([]),
});

const taskListSchema = z.object({
  tasks: z.array(taskSchema).optional().default([]),
});

const commentListSchema = z.object({
  comments: z.array(commentSchema).optional().default([]),
});

type ClickupTask = z.infer<typeof taskSchema>;
type ClickupComment = z.infer<typeof commentSchema>;

export type ClickupRow = {
  item: IssueTask;
  description: string;
  tags: IssueCardChip[];
};

export type ClickupDetail = ClickupRow & {
  comments: IssueCardComment[];
};

export const mapClickupTask = (raw: ClickupTask): ClickupRow | null => {
  if (raw.id === '' || raw.name === '') {
    return null;
  }
  const assignee = raw.assignees.find((entry) => entry.username !== '' || entry.id !== '');
  const priority = raw.priority ?? '';
  return {
    item: {
      id: raw.id,
      title: raw.name,
      identifier: raw.custom_id || raw.id,
      url: raw.url || `https://app.clickup.com/t/${raw.id}`,
      status: raw.status || undefined,
      priority: priority || undefined,
      assignee: assignee?.username || assignee?.id,
    },
    description: raw.text_content,
    tags: raw.tags.map((tag) => ({ id: tag.name, name: tag.name })),
  };
};

export const mapClickupComment = (raw: ClickupComment): IssueCardComment | null => {
  if (raw.id === '') {
    return null;
  }
  const date = raw.date === undefined ? Number.NaN : Number(raw.date);
  const when = Number.isFinite(date) ? new Date(date).toISOString().slice(0, 10) : '';
  return {
    id: raw.id,
    author: raw.user?.username || 'ClickUp',
    body: raw.comment_text,
    createdAt: when || undefined,
  };
};

export const buildClickupFilters = (
  items: readonly IssueTask[],
  pipeline: readonly string[] = [],
): IssueFilter[] => {
  const status = uniqueOptions([...pipeline, ...items.map((item) => item.status)]);
  const priority = uniqueOptions(items.map((item) => item.priority), priorityLabel);
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
  if (priority.length > 0) {
    filters.push({
      id: 'priority',
      label: 'Priority',
      field: 'priority',
      slot: 'end',
      value: 'all',
      options: [{ id: 'all', label: 'All' }, ...priority],
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
  return filters;
};

const uniqueOptions = (
  values: readonly (string | undefined)[],
  labelFor = (id: string) => id,
): { id: string; label: string }[] => {
  const seen = new Set<string>();
  const options: { id: string; label: string }[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push({ id: value, label: labelFor(value) });
  }
  return options;
};

export const priorityLabel = (id: string | undefined): string => {
  if (id === '1') {
    return PRIORITY_LABEL['1'];
  }
  if (id === '2') {
    return PRIORITY_LABEL['2'];
  }
  if (id === '3') {
    return PRIORITY_LABEL['3'];
  }
  if (id === '4') {
    return PRIORITY_LABEL['4'];
  }
  return id ?? '';
};

export const clickupListPath = (listId: string): string => `/api/v2/list/${encodeURIComponent(listId)}`;
export const clickupListTasksPath = (listId: string): string => `${clickupListPath(listId)}/task`;
export const clickupTaskPath = (taskId: string): string => `/api/v2/task/${encodeURIComponent(taskId)}`;
export const clickupTaskCommentsPath = (taskId: string): string => `${clickupTaskPath(taskId)}/comment`;

const clickupGet = async (transport: ClickupTransport, path: string, query?: Record<string, string>): Promise<string> => {
  const request: GuestRequest = { method: 'GET', path };
  if (query) {
    request.query = query;
  }
  const result = await transport.request(request);
  if (result.status >= 400) {
    throw new Error(`ClickUp ${result.status}`);
  }
  return result.body;
};

export const clickupStatusBody = (status: string): string | null => {
  const next = status.trim();
  if (next === '') {
    return null;
  }
  return JSON.stringify({ status: next });
};

export const setClickupStatus = async (transport: ClickupTransport, taskId: string, status: string): Promise<void> => {
  const body = clickupStatusBody(status);
  if (!body) {
    throw new Error('ClickUp status is empty');
  }
  const result = await transport.request({
    method: 'PUT',
    path: clickupTaskPath(taskId),
    body,
  });
  if (result.status >= 400) {
    throw new Error(`ClickUp ${result.status}`);
  }
};

const parseTaskArray = (text: string): ClickupTask[] => {
  const parsed = taskListSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data.tasks : [];
};

const parseCommentArray = (text: string): ClickupComment[] => {
  const parsed = commentListSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data.comments : [];
};

const parseTask = (text: string): ClickupTask | null => {
  const parsed = taskSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
};

export const CLICKUP_TASK_PAGE = 100;

export const hasMoreClickupPages = (pageCount: number): boolean => pageCount >= CLICKUP_TASK_PAGE;

export const statusesFromListJson = (text: string): string[] => {
  const parsed = listSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    return [];
  }
  return [...parsed.data.statuses]
    .sort((left, right) => Number(left.orderindex ?? 0) - Number(right.orderindex ?? 0))
    .map((entry) => entry.status)
    .filter((status) => status !== '');
};

export const rowsFromListJson = (text: string): ClickupRow[] => {
  const rows: ClickupRow[] = [];
  for (const task of parseTaskArray(text)) {
    const mapped = mapClickupTask(task);
    if (mapped) {
      rows.push(mapped);
    }
  }
  return rows;
};

export const detailFromBodies = (taskText: string, commentText: string): ClickupDetail | null => {
  const task = parseTask(taskText);
  if (!task) {
    return null;
  }
  const mapped = mapClickupTask(task);
  if (!mapped) {
    return null;
  }
  const comments: IssueCardComment[] = [];
  for (const comment of parseCommentArray(commentText)) {
    const next = mapClickupComment(comment);
    if (next) {
      comments.push(next);
    }
  }
  return { ...mapped, comments };
};

export type ClickupList = {
  rows: ClickupRow[];
  statuses: string[];
};

export const listClickupTasks = async (transport: ClickupTransport, listId: string): Promise<ClickupRow[]> => {
  const rows: ClickupRow[] = [];
  for (let page = 0; page < 20; page += 1) {
    const next = rowsFromListJson(await clickupGet(transport, clickupListTasksPath(listId), {
      include_closed: 'true',
      page: String(page),
    }));
    rows.push(...next);
    if (!hasMoreClickupPages(next.length)) {
      break;
    }
  }
  return rows;
};

const emptyStatuses = (): string[] => [];

export const loadClickupList = async (transport: ClickupTransport, listId: string): Promise<ClickupList> => {
  const [statuses, rows] = await Promise.all([
    clickupGet(transport, clickupListPath(listId))
      .then(statusesFromListJson)
      .catch(emptyStatuses),
    listClickupTasks(transport, listId),
  ]);
  return { rows, statuses };
};

export const getClickupTask = async (transport: ClickupTransport, taskId: string): Promise<ClickupDetail | null> => {
  const [taskBody, commentBody] = await Promise.all([
    clickupGet(transport, clickupTaskPath(taskId)),
    clickupGet(transport, clickupTaskCommentsPath(taskId)),
  ]);
  return detailFromBodies(taskBody, commentBody);
};
