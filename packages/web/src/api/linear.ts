import type {
  LinearAPI,
  LinearAuthOrigin,
  LinearAuthStart,
  LinearAuthStatus,
  LinearIssue,
  LinearIssueAssignee,
  LinearIssueComment,
  LinearIssueGetResult,
  LinearIssueState,
  LinearIssueSummary,
  LinearIssueTeam,
  LinearIssuesListResult,
  LinearMappingResult,
  LinearMappingWrite,
  LinearOrganizationSummary,
  LinearSessionStatusPostInput,
  LinearSessionStatusPostResult,
  LinearTeamMapping,
  LinearUserSummary,
  LinearWorkspaceSummary,
} from '@openchamber/ui/lib/api/types';
import { runtimeFetch } from '@openchamber/ui/lib/runtime-fetch';

type LinearJson = {
  connected?: boolean;
  user?: LinearUserSummary | null;
  organization?: LinearOrganizationSummary | null;
  scope?: string;
  workspaces?: LinearWorkspaceSummary[];
  authorizationUrl?: string;
  expiresIn?: number;
  removed?: boolean;
  error?: string;
  issues?: LinearIssueSummary[];
  cursor?: string | null;
  hasMore?: boolean;
  issue?: LinearIssue | null;
  defaultProjectPath?: string | null;
  teams?: LinearTeamMapping[];
  posted?: boolean;
  skipped?: string;
  commentId?: string | null;
};

async function readLinearJson(response: Response): Promise<LinearJson | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readErrorMessage(payload: LinearJson | null, fallback: string): string {
  const error = payload?.error?.trim();
  return error || fallback;
}

function parseUser(payload: LinearUserSummary | null | undefined): LinearUserSummary | null {
  const id = payload?.id?.trim();
  if (!id) return null;
  return {
    id,
    name: payload?.name?.trim() || null,
    displayName: payload?.displayName?.trim() || null,
    email: payload?.email?.trim() || null,
    avatarUrl: payload?.avatarUrl?.trim() || null,
  };
}

function parseOrganization(payload: LinearOrganizationSummary | null | undefined): LinearOrganizationSummary | null {
  const id = payload?.id?.trim();
  const name = payload?.name?.trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    urlKey: payload?.urlKey?.trim() || null,
  };
}

function parseWorkspace(payload: LinearWorkspaceSummary | null | undefined): LinearWorkspaceSummary | null {
  const id = payload?.id?.trim();
  if (!id) return null;
  const authorizedAt = payload?.authorizedAt;
  return {
    id,
    name: payload?.name?.trim() || null,
    urlKey: payload?.urlKey?.trim() || null,
    current: payload?.current === true,
    user: parseUser(payload?.user),
    authorizedAt: typeof authorizedAt === 'number' && Number.isFinite(authorizedAt) ? authorizedAt : null,
  };
}

function toAuthStatus(payload: LinearJson | null): LinearAuthStatus | null {
  if (payload?.connected !== true && payload?.connected !== false) {
    return null;
  }
  const workspaces = Array.isArray(payload.workspaces)
    ? payload.workspaces.map(parseWorkspace).filter((entry): entry is LinearWorkspaceSummary => entry != null)
    : [];
  return {
    connected: payload.connected,
    user: parseUser(payload.user),
    organization: parseOrganization(payload.organization),
    scope: payload.scope?.trim() || undefined,
    workspaces: payload.connected ? workspaces : undefined,
  };
}

function toAuthStart(payload: LinearJson | null): LinearAuthStart | null {
  const authorizationUrl = payload?.authorizationUrl?.trim();
  const expiresIn = payload?.expiresIn;
  const scope = payload?.scope?.trim();
  if (!authorizationUrl || !Number.isFinite(expiresIn) || expiresIn == null || !scope) {
    return null;
  }
  return { authorizationUrl, expiresIn, scope };
}

function parseState(payload: LinearIssueState | null | undefined): LinearIssueState | null {
  const name = payload?.name?.trim() || null;
  const type = payload?.type?.trim() || null;
  if (!name && !type) return null;
  return { name, type };
}

function parseAssignee(payload: LinearIssueAssignee | null | undefined): LinearIssueAssignee | null {
  const name = payload?.name?.trim() || null;
  const displayName = payload?.displayName?.trim() || null;
  const avatarUrl = payload?.avatarUrl?.trim() || null;
  if (!name && !displayName && !avatarUrl) return null;
  return { name, displayName, avatarUrl };
}

function parseTeam(payload: LinearIssueTeam | null | undefined): LinearIssueTeam | null {
  const id = payload?.id?.trim();
  const key = payload?.key?.trim();
  const name = payload?.name?.trim();
  if (!id || !key || !name) return null;
  return { id, key, name };
}

function parseIssueSummary(payload: LinearIssueSummary | null | undefined): LinearIssueSummary | null {
  const id = payload?.id?.trim();
  const identifier = payload?.identifier?.trim();
  const title = payload?.title?.trim();
  const url = payload?.url?.trim();
  if (!id || !identifier || !title || !url) return null;
  return {
    id,
    identifier,
    title,
    url,
    state: parseState(payload.state),
    assignee: parseAssignee(payload.assignee),
    team: parseTeam(payload.team),
  };
}

function parseComment(payload: LinearIssueComment | null | undefined): LinearIssueComment | null {
  const id = payload?.id?.trim();
  if (!id) return null;
  const body = payload?.body;
  return {
    id,
    body: typeof body === 'string' ? body : '',
    createdAt: payload?.createdAt?.trim() || null,
    user: payload?.user
      ? {
        name: payload.user.name?.trim() || null,
        displayName: payload.user.displayName?.trim() || null,
      }
      : null,
  };
}

function parseIssue(payload: LinearIssue | null | undefined): LinearIssue | null {
  const summary = parseIssueSummary(payload);
  if (!summary) return null;
  const comments = Array.isArray(payload?.comments)
    ? payload.comments.map(parseComment).filter((comment): comment is LinearIssueComment => comment != null)
    : [];
  const description = payload?.description;
  return {
    ...summary,
    description: typeof description === 'string' ? description : null,
    comments,
  };
}

function toIssuesList(payload: LinearJson | null): LinearIssuesListResult | null {
  if (payload?.connected !== true && payload?.connected !== false) {
    return null;
  }
  if (payload.connected === false) {
    return { connected: false };
  }
  const issues = Array.isArray(payload.issues)
    ? payload.issues.map(parseIssueSummary).filter((issue): issue is LinearIssueSummary => issue != null)
    : [];
  return {
    connected: true,
    issues,
    cursor: payload.cursor?.trim() || null,
    hasMore: payload.hasMore === true,
  };
}

function toIssueGet(payload: LinearJson | null): LinearIssueGetResult | null {
  if (payload?.connected !== true && payload?.connected !== false) {
    return null;
  }
  if (payload.connected === false) {
    return { connected: false };
  }
  return {
    connected: true,
    issue: parseIssue(payload.issue),
  };
}

function parseTeamMapping(payload: LinearTeamMapping | null | undefined): LinearTeamMapping | null {
  const id = payload?.id?.trim();
  const key = payload?.key?.trim();
  const name = payload?.name?.trim();
  if (!id || !key || !name) return null;
  const projectPath = payload?.projectPath?.trim() || null;
  return { id, key, name, projectPath };
}

function toMapping(payload: LinearJson | null): LinearMappingResult | null {
  if (payload?.connected !== true && payload?.connected !== false) {
    return null;
  }
  if (payload.connected === false) {
    return { connected: false };
  }
  const teams = Array.isArray(payload.teams)
    ? payload.teams.map(parseTeamMapping).filter((team): team is LinearTeamMapping => team != null)
    : [];
  return {
    connected: true,
    defaultProjectPath: payload.defaultProjectPath?.trim() || null,
    teams,
  };
}

function parseSkipped(value: string | undefined): 'already-posted' | 'issue-not-found' | 'not-started' | null {
  if (value === 'already-posted' || value === 'issue-not-found' || value === 'not-started') {
    return value;
  }
  return null;
}

function toSessionStatusPost(payload: LinearJson | null): LinearSessionStatusPostResult | null {
  if (payload?.connected !== true && payload?.connected !== false) {
    return null;
  }
  if (payload.connected === false) {
    return { connected: false };
  }
  if (payload.posted === true) {
    return {
      connected: true,
      posted: true,
      commentId: payload.commentId?.trim() || null,
    };
  }
  const skipped = parseSkipped(payload.skipped);
  if (payload.posted === false && skipped) {
    return { connected: true, posted: false, skipped };
  }
  return null;
}

export const createWebLinearAPI = (): LinearAPI => ({
  async authStatus(): Promise<LinearAuthStatus> {
    const response = await runtimeFetch('/api/linear/auth/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const payload = await readLinearJson(response);
    const status = toAuthStatus(payload);
    if (!response.ok || !status) {
      throw new Error(readErrorMessage(payload, response.statusText || 'Failed to load Linear status'));
    }
    return status;
  },

  async authStart(origin?: LinearAuthOrigin): Promise<LinearAuthStart> {
    const response = await runtimeFetch('/api/linear/auth/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(origin ? { origin } : {}),
    });
    const payload = await readLinearJson(response);
    const started = toAuthStart(payload);
    if (!response.ok || !started) {
      throw new Error(readErrorMessage(payload, response.statusText || 'Failed to start Linear auth'));
    }
    return started;
  },

  async authDisconnect(): Promise<{ removed: boolean }> {
    const response = await runtimeFetch('/api/linear/auth', {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });
    const payload = await readLinearJson(response);
    if (!response.ok) {
      throw new Error(readErrorMessage(payload, response.statusText || 'Failed to disconnect Linear'));
    }
    return { removed: payload?.removed === true };
  },

  async authActivate(organizationId: string): Promise<LinearAuthStatus> {
    const response = await runtimeFetch('/api/linear/auth/activate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ organizationId }),
    });
    const payload = await readLinearJson(response);
    const status = toAuthStatus(payload);
    if (!response.ok || !status) {
      throw new Error(readErrorMessage(payload, response.statusText || 'Failed to switch Linear workspace'));
    }
    return status;
  },

  async issuesList(options?: { query?: string; cursor?: string }): Promise<LinearIssuesListResult> {
    const params = new URLSearchParams();
    const query = options?.query?.trim();
    const cursor = options?.cursor?.trim();
    if (query) params.set('query', query);
    if (cursor) params.set('cursor', cursor);
    const queryString = params.toString();
    const suffix = queryString ? `?${queryString}` : '';
    const response = await runtimeFetch(`/api/linear/issues/list${suffix}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const payload = await readLinearJson(response);
    const result = toIssuesList(payload);
    if (!response.ok || !result) {
      throw new Error(readErrorMessage(payload, response.statusText || 'Failed to load Linear issues'));
    }
    return result;
  },

  async issueGet(id: string): Promise<LinearIssueGetResult> {
    const params = new URLSearchParams({ id });
    const response = await runtimeFetch(`/api/linear/issues/get?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const payload = await readLinearJson(response);
    const result = toIssueGet(payload);
    if (!response.ok || !result) {
      throw new Error(readErrorMessage(payload, response.statusText || 'Failed to load Linear issue'));
    }
    return result;
  },

  async mappingGet(): Promise<LinearMappingResult> {
    const response = await runtimeFetch('/api/linear/mapping', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const payload = await readLinearJson(response);
    const result = toMapping(payload);
    if (!response.ok || !result) {
      throw new Error(readErrorMessage(payload, response.statusText || 'Failed to load Linear mapping'));
    }
    return result;
  },

  async mappingSet(mapping: LinearMappingWrite): Promise<LinearMappingResult> {
    const response = await runtimeFetch('/api/linear/mapping', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        defaultProjectPath: mapping.defaultProjectPath,
        teamProjectPaths: mapping.teamProjectPaths,
      }),
    });
    const payload = await readLinearJson(response);
    const result = toMapping(payload);
    if (!response.ok || !result) {
      throw new Error(readErrorMessage(payload, response.statusText || 'Failed to save Linear mapping'));
    }
    return result;
  },

  async sessionStatusPost(input: LinearSessionStatusPostInput): Promise<LinearSessionStatusPostResult> {
    const response = await runtimeFetch('/api/linear/session-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        kind: input.kind,
        sessionId: input.sessionId,
        issueIdentifier: input.issueIdentifier,
        sessionOrigin: input.sessionOrigin,
        sessionTitle: input.sessionTitle,
      }),
    });
    const payload = await readLinearJson(response);
    const result = toSessionStatusPost(payload);
    if (!response.ok || !result) {
      throw new Error(readErrorMessage(payload, response.statusText || 'Failed to post Linear session status'));
    }
    return result;
  },
});
