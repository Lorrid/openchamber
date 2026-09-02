import { connectHost, HostRequestError } from '@openchamber/sdk';
import type { GuestConnection } from '@openchamber/sdk';
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
  buildLinearFilters,
  getLinearIssue,
  loadLinearList,
  priorityLabel,
  type LinearRow,
  type LinearTransport,
} from './linear.ts';

const PROVIDER_ID = 'linear-issues';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root');
}

const host = connectHost();
const transport: LinearTransport = {
  request: (request) => host.request(request),
};

let page: IssueViewHandle | null = null;
let card: IssueCardHandle | null = null;
let empty: EmptyHandle | null = null;
let connection: GuestConnection = { connected: false, account: '' };
let rows: LinearRow[] = [];
let cardComments: IssueCardComment[] = [];
let surface: 'panel' | 'dialog' = 'panel';
const filterValues: Record<string, string> = {};

const report = (error: HostRequestError): void => {
  void host.toast({ kind: 'error', message: error.message });
};

const fail = (message: string): void => {
  void host.toast({ kind: 'error', message });
};

const rememberFilter = (id: string, value: string): void => {
  filterValues[id] = value;
};

const openUrl = (url: string): void => {
  void host.openUrl(url).catch(report);
};

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
    url: item.url ?? '',
    text: `${item.identifier ?? item.id}: ${item.title}`,
  }).then(() => host.close()).catch(report);
};

const openIssue = (item: IssueTask): void => {
  if (!item.url) {
    return;
  }
  openUrl(item.url);
};

const items = (): IssueTask[] => rows.map((row) => row.item);

const listFilters = () => buildLinearFilters(items(), filterValues);

const showDisconnected = (): void => {
  disposeViews();
  empty = mountEmpty(root, {
    title: 'Connect Linear',
    body: 'Connect Linear on Settings → Integrations, then come back here.',
    action: {
      label: 'Connect',
      onClick: () => {
        void host.oauthStart().catch(report);
      },
    },
  });
};

const showPage = (busy: boolean): void => {
  disposeViews();
  page = mountIssuePage(root, {
    items: items(),
    filters: listFilters(),
    busy,
    onSelect: showCard,
    onOpen: openIssue,
    onFilterChange: rememberFilter,
  });
};

const rowFor = (id: string): LinearRow | undefined => rows.find((entry) => entry.item.id === id);

const cardProps = (item: IssueTask, row: LinearRow, comments: IssueCardComment[] = []) => ({
  item,
  description: row.description,
  fields: [
    { label: 'Assignee', value: item.assignee ?? '' },
    { label: 'Priority', value: item.priority ?? priorityLabel(0) },
    { label: 'Team', value: item.team ?? '' },
  ],
  comments,
  onBack: () => showPage(false),
  onOpen: openIssue,
  onOpenUrl: openUrl,
  onAction: attachIssue,
  labels: { action: 'Attach' },
});

const showCard = (item: IssueTask): void => {
  const row = rowFor(item.id);
  if (!row) {
    return;
  }
  disposeViews();
  cardComments = [];
  card = mountIssueCard(root, cardProps(item, row, []));
  if (!connection.connected) {
    return;
  }
  void getLinearIssue(transport, item.id).then((detail) => {
    if (!detail || !card) {
      return;
    }
    cardComments = detail.comments;
    card.update(cardProps(detail.row.item, detail.row, detail.comments));
  }).catch(() => {
    fail('Could not load that Linear issue.');
  });
};

const loadList = async (): Promise<void> => {
  if (!connection.connected) {
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
      onFilterChange: rememberFilter,
    });
    try {
      rows = await loadLinearList(transport);
      page.update({
        items: items(),
        filters: listFilters(),
        onSelect: attachIssue,
        onOpen: openIssue,
        onFilterChange: rememberFilter,
      });
    } catch {
      rows = [];
      fail('Could not load Linear issues.');
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
    rows = await loadLinearList(transport);
    showPage(false);
  } catch {
    rows = [];
    showPage(false);
    fail('Could not load Linear issues.');
  }
};

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  surface = ctx.surface;
  connection = ctx.connection;
  void loadList();
});

host.onConnection((next) => {
  connection = next;
  void loadList();
});
