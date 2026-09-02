import { connectHost, HostRequestError } from '@openchamber/sdk';
import {
  applyHostReady,
  mountAttachIssues,
  mountIssueCard,
  mountIssuePage,
  type IssueCardChip,
  type IssueCardComment,
  type IssueCardHandle,
  type IssueFilter,
  type IssueTask,
  type IssueViewHandle,
} from '@openchamber/sdk/ui';

const PROVIDER_ID = 'hello';
const REPO_URL = 'https://github.com/openchamber/openchamber';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root');
}

const host = connectHost();
let page: IssueViewHandle | null = null;
let card: IssueCardHandle | null = null;
let readyOnce = false;

const report = (error: HostRequestError): void => {
  void host.toast({ kind: 'error', message: error.message });
};

const attachIssue = (item: IssueTask): void => {
  void host.attach({
    providerId: PROVIDER_ID,
    id: item.id,
    title: item.title,
    url: item.url ?? `${REPO_URL}#${item.id}`,
    text: `${item.identifier ?? item.id}: ${item.title}`,
  }).then(() => host.close()).catch(report);
};

const openIssue = (item: IssueTask): void => {
  if (!item.url) {
    return;
  }
  void host.openUrl(item.url).catch(report);
};

const fieldLabel = (options: readonly { id: string; label: string }[], id: string | undefined): string => (
  options.find((entry) => entry.id === id)?.label ?? id ?? ''
);

const showPage = (): void => {
  card?.dispose();
  card = null;
  page?.dispose();
  page = mountIssuePage(root, {
    items: PAGE_ISSUES,
    filters: PAGE_FILTERS,
    onSelect: showCard,
    onOpen: openIssue,
  });
};

const cardProps = (item: IssueTask) => {
  const detail = CARD_DETAILS[item.id];
  return {
    item,
    description: detail?.description,
    status: item.status
      ? { value: item.status, options: STATUS_OPTIONS }
      : undefined,
    fields: [
      { label: 'Team', value: fieldLabel(TEAM_OPTIONS, item.team) },
      { label: 'Assignee', value: fieldLabel(ASSIGNEE_OPTIONS, item.assignee) },
      { label: 'Priority', value: fieldLabel(PRIORITY_OPTIONS, item.priority) },
    ],
    tags: detail?.tags,
    comments: detail?.comments,
    onBack: showPage,
    onOpen: openIssue,
    onAction: attachIssue,
    onStatusChange: (value: string) => {
      item.status = value;
      card?.update(cardProps(item));
    },
    labels: { action: 'Attach' },
  };
};

const showCard = (item: IssueTask): void => {
  page?.dispose();
  page = null;
  card?.dispose();
  card = mountIssueCard(root, cardProps(item));
};

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  if (readyOnce) {
    return;
  }
  readyOnce = true;
  if (ctx.surface === 'dialog') {
    page = mountAttachIssues(root, {
      items: DIALOG_ISSUES,
      onSelect: attachIssue,
      onOpen: openIssue,
    });
    return;
  }
  showPage();
});

const STATUS_OPTIONS = [
  { id: 'todo', label: 'Todo' },
  { id: 'started', label: 'Started' },
  { id: 'done', label: 'Done' },
];

const PRIORITY_OPTIONS = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

const ASSIGNEE_OPTIONS = [
  { id: 'ada', label: 'Ada' },
  { id: 'bev', label: 'Bev' },
  { id: 'cam', label: 'Cam' },
];

const TEAM_OPTIONS = [
  { id: 'eng', label: 'Eng' },
  { id: 'design', label: 'Design' },
];

const PAGE_ISSUES: IssueTask[] = [
  { id: 'HELLO-1', identifier: 'HELLO-1', title: 'Login form submits twice', status: 'started', priority: 'urgent', assignee: 'ada', team: 'eng', url: `${REPO_URL}#HELLO-1` },
  { id: 'HELLO-2', identifier: 'HELLO-2', title: 'Empty search state copy', status: 'todo', priority: 'high', assignee: 'bev', team: 'design', url: `${REPO_URL}#HELLO-2` },
  { id: 'HELLO-3', identifier: 'HELLO-3', title: 'Attach chip after picker close', status: 'todo', priority: 'high', assignee: 'ada', team: 'eng', url: `${REPO_URL}#HELLO-3` },
  { id: 'HELLO-4', identifier: 'HELLO-4', title: 'Filter by assignee on a remote list', status: 'started', priority: 'medium', assignee: 'cam', team: 'eng', url: `${REPO_URL}#HELLO-4` },
  { id: 'HELLO-5', identifier: 'HELLO-5', title: 'Theme tokens on the picker chrome', status: 'done', priority: 'low', assignee: 'bev', team: 'design', url: `${REPO_URL}#HELLO-5` },
  { id: 'HELLO-6', identifier: 'HELLO-6', title: 'Ship a classic IIFE with the panel', status: 'todo', priority: 'medium', assignee: 'cam', team: 'eng', url: `${REPO_URL}#HELLO-6` },
];

const DIALOG_ISSUES: IssueTask[] = [
  { id: '128', identifier: '#128', title: 'Login form submits twice', url: `${REPO_URL}/issues/128` },
  { id: '142', identifier: '#142', title: 'Empty search state copy', url: `${REPO_URL}/issues/142` },
  { id: 'ENG-18', identifier: 'ENG-18', title: 'Attach chip after picker close', url: 'https://linear.app/openchamber/issue/ENG-18' },
  { id: 'DES-4', identifier: 'DES-4', title: 'Theme tokens on the picker chrome', url: 'https://linear.app/openchamber/issue/DES-4' },
];

const PAGE_FILTERS: IssueFilter[] = [
  {
    id: 'status',
    label: 'Status',
    field: 'status',
    slot: 'start',
    value: 'all',
    options: [
      { id: 'all', label: 'All' },
      { id: 'todo', label: 'Todo' },
      { id: 'started', label: 'Started' },
      { id: 'done', label: 'Done' },
    ],
  },
  {
    id: 'priority',
    label: 'Priority',
    field: 'priority',
    slot: 'end',
    value: 'all',
    options: [
      { id: 'all', label: 'All' },
      { id: 'urgent', label: 'Urgent' },
      { id: 'high', label: 'High' },
      { id: 'medium', label: 'Medium' },
      { id: 'low', label: 'Low' },
    ],
  },
  {
    id: 'assignee',
    label: 'Assignee',
    field: 'assignee',
    slot: 'end',
    value: 'all',
    options: [
      { id: 'all', label: 'Any' },
      { id: 'ada', label: 'Ada' },
      { id: 'bev', label: 'Bev' },
      { id: 'cam', label: 'Cam' },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    field: 'team',
    slot: 'end',
    value: 'all',
    options: [
      { id: 'all', label: 'All teams' },
      { id: 'eng', label: 'Eng' },
      { id: 'design', label: 'Design' },
    ],
  },
];

type CardDetail = {
  description?: string;
  tags?: IssueCardChip[];
  comments?: IssueCardComment[];
};

const CARD_DETAILS = {
  'HELLO-1': {
    description: 'Submitting the login form twice creates two sessions. Reproduce with a slow network and a double click on Sign in.',
    tags: [{ id: 'bug', name: 'bug' }],
    comments: [
      { id: 'c1', author: 'Ada', createdAt: 'Mar 2', body: 'I can reproduce this on the preview build.' },
      { id: 'c2', author: 'Cam', createdAt: 'Mar 3', body: 'Guard the submit handler before the request leaves.' },
    ],
  },
  'HELLO-2': {
    description: 'Empty search should say there are no matching issues, not a generic blank panel.',
    tags: [{ id: 'copy', name: 'copy' }],
  },
  'HELLO-5': {
    description: 'The picker chrome must read host tokens. Without applyHostReady it falls back to raw iframe colors.',
    tags: [{ id: 'theme', name: 'theme' }],
    comments: [
      { id: 'c3', author: 'Bev', createdAt: 'Mar 4', body: 'Check elevated and selection after a theme switch.' },
    ],
  },
} satisfies Record<string, CardDetail>;
