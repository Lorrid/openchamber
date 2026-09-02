import { connectHost, HostRequestError } from '@openchamber/sdk';
import type { GuestConnection, GuestSettings } from '@openchamber/sdk';
import {
  applyHostReady,
  mountAttachIssues,
  mountEmpty,
  mountIssueCard,
  mountIssuePage,
  type EmptyHandle,
  type IssueCardComment,
  type IssueCardHandle,
  type IssueTask,
  type IssueViewHandle,
} from '@openchamber/sdk/ui';
import {
  buildClickupFilters,
  getClickupTask,
  loadClickupList,
  priorityLabel,
  setClickupStatus,
  type ClickupRow,
  type ClickupTransport,
} from './clickup.ts';

const PROVIDER_ID = 'clickup';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root');
}

const host = connectHost();
const transport: ClickupTransport = {
  request: (request) => host.request(request),
};

let page: IssueViewHandle | null = null;
let card: IssueCardHandle | null = null;
let empty: EmptyHandle | null = null;
let connection: GuestConnection = { connected: false, account: '' };
let settings: GuestSettings = {};
let rows: ClickupRow[] = [];
let statuses: string[] = [];
let cardComments: IssueCardComment[] = [];
let surface: 'panel' | 'dialog' = 'panel';

const report = (error: HostRequestError): void => {
  void host.toast({ kind: 'error', message: error.message });
};

const fail = (message: string): void => {
  void host.toast({ kind: 'error', message });
};

const listId = (): string => settings['list-id']?.trim() ?? '';

const configured = (): boolean => connection.connected && listId() !== '';

const disposeViews = (): void => {
  empty?.dispose();
  empty = null;
  card?.dispose();
  card = null;
  page?.dispose();
  page = null;
};

const attachIssue = (item: IssueTask): void => {
  void host.attach({
    providerId: PROVIDER_ID,
    id: item.id,
    title: item.title,
    url: item.url ?? `https://app.clickup.com/t/${item.id}`,
    text: `${item.identifier ?? item.id}: ${item.title}`,
  }).then(() => host.close()).catch(report);
};

const openIssue = (item: IssueTask): void => {
  if (!item.url) {
    return;
  }
  void host.openUrl(item.url).catch(report);
};

const items = (): IssueTask[] => rows.map((row) => row.item);

const showDisconnected = (): void => {
  disposeViews();
  empty = mountEmpty(root, {
    title: 'Connect ClickUp',
    body: connection.connected
      ? 'Save a list id on Settings → Integrations.'
      : 'Paste a ClickUp API token and list id on Settings → Integrations, then come back here.',
  });
};

const showPage = (busy: boolean): void => {
  disposeViews();
  page = mountIssuePage(root, {
    items: items(),
    filters: buildClickupFilters(items(), statuses),
    busy,
    onSelect: showCard,
    onOpen: openIssue,
  });
};

const statusOptions = () => {
  const filter = buildClickupFilters(items(), statuses).find((entry) => entry.id === 'status');
  return filter?.options.filter((option) => option.id !== 'all') ?? [];
};

const rowFor = (id: string): ClickupRow | undefined => rows.find((entry) => entry.item.id === id);

const setRowStatus = (id: string, status: string): IssueTask | null => {
  const current = rowFor(id);
  if (!current) {
    return null;
  }
  const next: ClickupRow = { ...current, item: { ...current.item, status } };
  rows = rows.map((entry) => (entry.item.id === id ? next : entry));
  return next.item;
};

const paintCard = (item: IssueTask): void => {
  const row = rowFor(item.id);
  if (!row || !card) {
    return;
  }
  card.update(cardProps(item, row, cardComments));
};

const changeStatus = (item: IssueTask, status: string): void => {
  const previous = item.status;
  if (status === previous) {
    return;
  }
  const next = setRowStatus(item.id, status);
  if (next) {
    paintCard(next);
  }
  if (!configured()) {
    return;
  }
  void setClickupStatus(transport, item.id, status).catch(() => {
    if (previous !== undefined) {
      const reverted = setRowStatus(item.id, previous);
      if (reverted) {
        paintCard(reverted);
      }
    }
    fail('Could not update that ClickUp status.');
  });
};

const cardProps = (item: IssueTask, row: ClickupRow, comments: IssueCardComment[] = []) => {
  const options = statusOptions();
  const statusValue = item.status ?? options[0]?.id ?? '';
  return {
    item,
    description: row.description,
    status: statusValue
      ? {
        value: statusValue,
        options: options.length > 0 ? options : [{ id: statusValue, label: statusValue }],
      }
      : undefined,
    fields: [
      { label: 'Assignee', value: item.assignee ?? '' },
      { label: 'Priority', value: priorityLabel(item.priority) },
    ],
    tags: row.tags,
    comments,
    onBack: () => showPage(false),
    onOpen: openIssue,
    onAction: attachIssue,
    onStatusChange: (value: string) => {
      changeStatus(item, value);
    },
    labels: { action: 'Attach' },
  };
};

const showCard = (item: IssueTask): void => {
  const row = rows.find((entry) => entry.item.id === item.id);
  if (!row) {
    return;
  }
  disposeViews();
  cardComments = [];
  card = mountIssueCard(root, cardProps(item, row, []));
  if (!configured()) {
    return;
  }
  void getClickupTask(transport, item.id).then((detail) => {
    if (!detail || !card) {
      return;
    }
    const current = rowFor(item.id);
    cardComments = detail.comments;
    card.update(cardProps(current?.item ?? detail.item, current ?? detail, detail.comments));
  }).catch(() => {
    fail('Could not load that ClickUp task.');
  });
};

const loadList = async (): Promise<void> => {
  if (!configured()) {
    showDisconnected();
    return;
  }
  if (surface === 'dialog') {
    disposeViews();
    page = mountAttachIssues(root, {
      items: [],
      busy: true,
      onSelect: attachIssue,
      onOpen: openIssue,
    });
    try {
      const list = await loadClickupList(transport, listId());
      rows = list.rows;
      statuses = list.statuses;
      page.update({
        items: items(),
        onSelect: attachIssue,
        onOpen: openIssue,
      });
    } catch {
      rows = [];
      statuses = [];
      fail('Could not load the ClickUp list.');
      page.update({
        items: [],
        onSelect: attachIssue,
        onOpen: openIssue,
      });
    }
    return;
  }
  showPage(true);
  try {
    const list = await loadClickupList(transport, listId());
    rows = list.rows;
    statuses = list.statuses;
    showPage(false);
  } catch {
    rows = [];
    statuses = [];
    showPage(false);
    fail('Could not load the ClickUp list.');
  }
};

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  surface = ctx.surface;
  connection = ctx.connection;
  settings = ctx.settings;
  void loadList();
});

host.onConnection((next) => {
  connection = next;
  void loadList();
});

host.onSettings((next) => {
  settings = next;
  void loadList();
});
