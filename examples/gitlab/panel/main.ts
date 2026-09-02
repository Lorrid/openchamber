import { connectHost, HostRequestError } from '@openchamber/sdk';
import type { GuestConnection, GuestSettings } from '@openchamber/sdk';
import {
  applyHostReady,
  mountAttachIssues,
  mountEmpty,
  mountIssueCard,
  mountIssuePage,
  mountPullRequest,
  type EmptyHandle,
  type IssueCardComment,
  type IssueCardHandle,
  type IssueTask,
  type IssueViewHandle,
  type PullRequestHandle,
} from '@openchamber/sdk/ui';
import {
  buildGitlabFilters,
  createGitlabMergeRequest,
  getGitlabIssue,
  getGitlabMergeRequest,
  getGitlabMergeRequestDiff,
  loadGitlabAttachPage,
  loadGitlabList,
  mergeGitlabMergeRequest,
  setGitlabState,
  writeGitlabMergeRequest,
  type GitlabPullDetail,
  type GitlabRow,
  type GitlabTransport,
} from './gitlab.ts';

const PROVIDER_ID = 'gitlab';
const STATE_OPTIONS = [
  { id: 'opened', label: 'opened' },
  { id: 'closed', label: 'closed' },
];

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root');
}

const host = connectHost();
const transport: GitlabTransport = {
  request: (request) => host.request(request),
};

let page: IssueViewHandle | null = null;
let card: IssueCardHandle | null = null;
let pull: PullRequestHandle | null = null;
let empty: EmptyHandle | null = null;
let connection: GuestConnection = { connected: false, account: '' };
let settings: GuestSettings = {};
let rows: GitlabRow[] = [];
let cardComments: IssueCardComment[] = [];
let currentPull: GitlabPullDetail | null = null;
let surface: 'panel' | 'dialog' = 'panel';
let attachPage = 1;
let attachHasMore = false;
let attachBusy = false;
let includeDiff = false;
let createInWorktree = false;

const report = (error: HostRequestError): void => {
  void host.toast({ kind: 'error', message: error.message });
};

const fail = (message: string): void => {
  void host.toast({ kind: 'error', message });
};

const projectPath = (): string => settings['project-path']?.trim() ?? '';

const configured = (): boolean => connection.connected && projectPath() !== '';

const disposeViews = (): void => {
  empty?.dispose();
  empty = null;
  card?.dispose();
  card = null;
  pull?.dispose();
  pull = null;
  page?.dispose();
  page = null;
};

const attachText = async (item: IssueTask, row: GitlabRow | undefined): Promise<string> => {
  const heading = `${item.identifier ?? item.id}: ${item.title}`;
  if (row?.thread !== 'pull' || !includeDiff) {
    return heading;
  }
  try {
    const diff = await getGitlabMergeRequestDiff(transport, projectPath(), item.id);
    if (!diff) {
      return heading;
    }
    return `${heading}\n\n${diff}`;
  } catch {
    return heading;
  }
};

const attachPayload = async (item: IssueTask, row: GitlabRow | undefined) => {
  const fallbackUrl = row?.thread === 'pull'
    ? `https://gitlab.com/${projectPath()}/-/merge_requests/${item.id.replace(/^!/, '')}`
    : `https://gitlab.com/${projectPath()}/-/issues/${item.id}`;
  return {
    providerId: PROVIDER_ID,
    id: item.id,
    title: item.title,
    url: item.url ?? fallbackUrl,
    text: await attachText(item, row),
    kind: row?.thread === 'pull' ? 'pull' as const : 'issue' as const,
    author: row?.author,
    branches: row?.branches,
  };
};

const attachIssue = (item: IssueTask): void => {
  const row = rowFor(item.id);
  void attachPayload(item, row).then((payload) => host.attach(payload)).then(() => host.close()).catch(report);
};

const startFromItem = (item: IssueTask, worktree: boolean): void => {
  const row = rowFor(item.id) ?? (currentPull && currentPull.item.id === item.id ? currentPull : undefined);
  void attachPayload(item, row).then((payload) => host.startSession({
    ...payload,
    worktree,
  })).catch(report);
};

const selectAttach = (item: IssueTask): void => {
  if (createInWorktree) {
    startFromItem(item, true);
    return;
  }
  attachIssue(item);
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
    title: 'Connect GitLab',
    body: connection.connected
      ? 'Save a project path on Settings → Integrations.'
      : 'Connect GitLab on Settings → Integrations, then come back here.',
    action: connection.connected
      ? undefined
      : {
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
    filters: buildGitlabFilters(items()),
    busy,
    onSelect: showSelected,
    onOpen: openIssue,
    action: configured()
      ? {
        label: 'New merge request',
        onClick: showCreate,
      }
      : undefined,
  });
};

const rowFor = (id: string): GitlabRow | undefined => rows.find((entry) => entry.item.id === id);

const setRowStatus = (id: string, status: string): IssueTask | null => {
  const current = rowFor(id);
  if (!current) {
    return null;
  }
  const next: GitlabRow = { ...current, item: { ...current.item, status } };
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
  void setGitlabState(transport, projectPath(), item.id, status).catch(() => {
    if (previous !== undefined) {
      const reverted = setRowStatus(item.id, previous);
      if (reverted) {
        paintCard(reverted);
      }
    }
    fail('Could not update that GitLab issue.');
  });
};

const cardProps = (item: IssueTask, row: GitlabRow, comments: IssueCardComment[] = []) => {
  const statusValue = item.status ?? 'opened';
  return {
    item,
    description: row.description,
    status: {
      value: statusValue,
      options: STATE_OPTIONS,
    },
    fields: [
      { label: 'Assignee', value: item.assignee ?? '' },
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
  void getGitlabIssue(transport, projectPath(), item.id).then((detail) => {
    if (!detail || !card) {
      return;
    }
    const current = rowFor(item.id);
    cardComments = detail.comments;
    card.update(cardProps(current?.item ?? detail.item, current ?? detail, detail.comments));
  }).catch(() => {
    fail('Could not load that GitLab issue.');
  });
};

const pullProps = (detail: GitlabPullDetail, busy: boolean) => ({
  mode: 'view' as const,
  pull: detail.pull,
  checks: detail.checks,
  checksSummary: detail.checks.length > 0
    ? {
      success: detail.checks.filter((check) => check.state === 'success').length,
      total: detail.checks.length,
    }
    : undefined,
  comments: detail.comments,
  busy,
  onBack: () => showPage(false),
  onOpen: () => {
    if (detail.pull.url) {
      void host.openUrl(detail.pull.url).catch(report);
    }
  },
  onRefresh: () => {
    void refreshPull(detail.item.id);
  },
  onAttach: () => {
    attachIssue(detail.item);
  },
  onStartSession: (worktree: boolean) => {
    startFromItem(detail.item, worktree);
  },
  onReady: detail.pull.state === 'draft'
    ? () => {
      void writeGitlabMergeRequest(transport, projectPath(), detail.item.id, JSON.stringify({ draft: false }))
        .then(() => refreshPull(detail.item.id))
        .catch(() => {
          fail('Could not mark that merge request ready.');
        });
    }
    : undefined,
  onMerge: detail.pull.state === 'open'
    ? (method: 'squash' | 'merge' | 'rebase') => {
      void mergeGitlabMergeRequest(transport, projectPath(), detail.item.id, method)
        .then(() => refreshPull(detail.item.id))
        .catch(() => {
          fail('Could not merge that request.');
        });
    }
    : undefined,
  onSendFailedChecks: () => {
    const failed = detail.checks.filter((check) => check.state === 'failure');
    if (failed.length === 0) {
      return;
    }
    void host.compose({
      text: failed.map((check) => `${check.name}: ${check.detail ?? check.state}`).join('\n'),
    }).catch(report);
  },
  onSendComments: () => {
    if (detail.comments.length === 0) {
      return;
    }
    void host.compose({
      text: detail.comments.map((comment) => `${comment.author}: ${comment.body}`).join('\n\n'),
    }).catch(report);
  },
  onSaveOverview: (title: string, body: string) => {
    void writeGitlabMergeRequest(transport, projectPath(), detail.item.id, JSON.stringify({
      title,
      description: body,
    })).then(() => refreshPull(detail.item.id)).catch(() => {
      fail('Could not update that merge request.');
    });
  },
});

const refreshPull = async (id: string): Promise<void> => {
  if (!configured() || !pull) {
    return;
  }
  if (currentPull) {
    pull.update({ ...pullProps(currentPull, true), busy: true });
  }
  try {
    const detail = await getGitlabMergeRequest(transport, projectPath(), id);
    if (!detail || !pull) {
      return;
    }
    currentPull = detail;
    rows = rows.map((entry) => (entry.item.id === detail.item.id ? detail : entry));
    pull.update(pullProps(detail, false));
  } catch {
    fail('Could not load that merge request.');
  }
};

const showPull = (item: IssueTask): void => {
  const row = rowFor(item.id);
  if (!row) {
    return;
  }
  disposeViews();
  currentPull = {
    ...row,
    pull: {
      id: item.id,
      title: item.title,
      url: item.url,
      state: item.status === 'merged' ? 'merged' : item.status === 'closed' ? 'closed' : 'open',
      head: row.branches?.head,
      base: row.branches?.base,
      author: row.author,
      body: row.description,
    },
    checks: [],
    comments: [],
  };
  pull = mountPullRequest(root, pullProps(currentPull, true));
  if (!configured()) {
    return;
  }
  void refreshPull(item.id);
};

const showCreate = (): void => {
  disposeViews();
  pull = mountPullRequest(root, {
    mode: 'create',
    create: {
      values: { base: 'main' },
      onSubmit: (values) => {
        if (!configured()) {
          return;
        }
        void createGitlabMergeRequest(transport, projectPath(), values).then((detail) => {
          if (!detail) {
            fail('Could not create that merge request.');
            return;
          }
          rows = [detail, ...rows.filter((entry) => entry.item.id !== detail.item.id)];
          currentPull = detail;
          disposeViews();
          pull = mountPullRequest(root, pullProps(detail, false));
        }).catch(() => {
          fail('Could not create that merge request.');
        });
      },
    },
    onBack: () => showPage(false),
  });
};

const showSelected = (item: IssueTask): void => {
  const row = rowFor(item.id);
  if (row?.thread === 'pull') {
    showPull(item);
    return;
  }
  showCard(item);
};

const attachProps = (busy: boolean) => ({
  items: items(),
  busy,
  onSelect: selectAttach,
  onOpen: openIssue,
  hasMore: attachHasMore,
  onMore: loadMoreAttach,
  toggle: {
    label: 'Include diff',
    checked: includeDiff,
    onChange: (checked: boolean) => {
      includeDiff = checked;
      page?.update(attachProps(attachBusy));
    },
  },
  session: {
    label: 'Create in worktree',
    checked: createInWorktree,
    onChange: (checked: boolean) => {
      createInWorktree = checked;
      page?.update(attachProps(attachBusy));
    },
  },
});

const loadMoreAttach = (): void => {
  if (!configured() || attachBusy || !attachHasMore) {
    return;
  }
  attachBusy = true;
  page?.update(attachProps(true));
  const nextPage = attachPage + 1;
  void loadGitlabAttachPage(transport, projectPath(), nextPage).then((list) => {
    attachPage = nextPage;
    rows = [...rows, ...list.rows];
    attachHasMore = list.hasMore;
    attachBusy = false;
    page?.update(attachProps(false));
  }).catch(() => {
    attachBusy = false;
    fail('Could not load more GitLab items.');
    page?.update(attachProps(false));
  });
};

const loadList = async (): Promise<void> => {
  if (!configured()) {
    showDisconnected();
    return;
  }
  if (surface === 'dialog') {
    attachPage = 1;
    attachHasMore = false;
    attachBusy = true;
    rows = [];
    disposeViews();
    page = mountAttachIssues(root, attachProps(true));
    try {
      const list = await loadGitlabAttachPage(transport, projectPath(), 1);
      rows = list.rows;
      attachHasMore = list.hasMore;
      attachBusy = false;
      page.update(attachProps(false));
    } catch {
      rows = [];
      attachBusy = false;
      fail('Could not load the GitLab project.');
      page.update(attachProps(false));
    }
    return;
  }
  showPage(true);
  try {
    const list = await loadGitlabList(transport, projectPath());
    rows = list.rows;
    showPage(false);
  } catch {
    rows = [];
    showPage(false);
    fail('Could not load the GitLab project.');
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
