import { clearLinearAuth, getLinearAuth, getLinearAuthByWorkspaceId } from './auth.js';
import { fetchLinearGraphql, getValidLinearAccessToken } from './client.js';
import { isPlainObject, isString, readTrimmedString } from './parse.js';

const PAGE_SIZE = 50;
const INCOMPLETE_ISSUE_FILTER = {
  state: { type: { nin: ['completed', 'canceled'] } },
};
const ISSUE_SUMMARY_FIELDS = `
  id
  identifier
  title
  url
  state { name type }
  assignee { name displayName avatarUrl }
  team { id key name }
`;
const LIST_QUERY = `
  query ListLinearIssues($first: Int!, $after: String, $filter: IssueFilter) {
    issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
      nodes { ${ISSUE_SUMMARY_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const SEARCH_QUERY = `
  query SearchLinearIssues($term: String!, $first: Int!, $after: String, $filter: IssueFilter) {
    searchIssues(term: $term, first: $first, after: $after, filter: $filter) {
      nodes { ${ISSUE_SUMMARY_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const GET_QUERY = `
  query GetLinearIssue($id: String!) {
    issue(id: $id) {
      ${ISSUE_SUMMARY_FIELDS}
      description
      comments(first: 50) {
        nodes {
          id
          body
          createdAt
          user { name displayName }
        }
      }
    }
  }
`;
const COMMENT_CREATE = `
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment { id }
    }
  }
`;
const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_IDENTIFIER_RE = /linear\.app\/(?:[^/]+\/)?issue\/([A-Za-z][A-Za-z0-9]*-\d+)/i;

export function parseLinearIssueRef(value) {
  const trimmed = readTrimmedString(value);
  if (!trimmed) return null;
  const urlMatch = trimmed.match(URL_IDENTIFIER_RE);
  if (urlMatch) {
    return { kind: 'identifier', value: urlMatch[1].toUpperCase() };
  }
  if (IDENTIFIER_RE.test(trimmed)) {
    return { kind: 'identifier', value: trimmed.toUpperCase() };
  }
  if (UUID_RE.test(trimmed)) {
    return { kind: 'id', value: trimmed.toLowerCase() };
  }
  return null;
}

function readState(value) {
  if (!isPlainObject(value)) return null;
  const name = readTrimmedString(value.name) || null;
  const type = readTrimmedString(value.type) || null;
  if (!name && !type) return null;
  return { name, type };
}

function readAssignee(value) {
  if (!isPlainObject(value)) return null;
  const name = readTrimmedString(value.name) || null;
  const displayName = readTrimmedString(value.displayName) || null;
  const avatarUrl = readTrimmedString(value.avatarUrl) || null;
  if (!name && !displayName && !avatarUrl) return null;
  return { name, displayName, avatarUrl };
}

function readTeam(value) {
  if (!isPlainObject(value)) return null;
  const id = readTrimmedString(value.id);
  const key = readTrimmedString(value.key);
  const name = readTrimmedString(value.name);
  if (!id || !key || !name) return null;
  return { id, key, name };
}

function readIssueSummary(node) {
  if (!isPlainObject(node)) return null;
  const id = readTrimmedString(node.id);
  const identifier = readTrimmedString(node.identifier);
  const title = readTrimmedString(node.title);
  const url = readTrimmedString(node.url);
  if (!id || !identifier || !title || !url) return null;
  return {
    id,
    identifier,
    title,
    url,
    state: readState(node.state),
    assignee: readAssignee(node.assignee),
    team: readTeam(node.team),
  };
}

function readComment(node) {
  if (!isPlainObject(node)) return null;
  const id = readTrimmedString(node.id);
  if (!id) return null;
  const body = isString(node.body) ? node.body : '';
  const user = isPlainObject(node.user)
    ? {
      name: readTrimmedString(node.user.name) || null,
      displayName: readTrimmedString(node.user.displayName) || null,
    }
    : null;
  return {
    id,
    body,
    createdAt: readTrimmedString(node.createdAt) || null,
    user: user && (user.name || user.displayName) ? user : null,
  };
}

function readIssue(node) {
  const summary = readIssueSummary(node);
  if (!summary) return null;
  const commentsPayload = isPlainObject(node.comments) ? node.comments.nodes : null;
  const comments = Array.isArray(commentsPayload)
    ? commentsPayload.map(readComment).filter(Boolean)
    : [];
  return {
    ...summary,
    description: isString(node.description) ? node.description : null,
    comments,
  };
}

function readPageInfo(connection) {
  const pageInfo = isPlainObject(connection) ? connection.pageInfo : null;
  if (!isPlainObject(pageInfo)) {
    return { hasMore: false, cursor: null };
  }
  return {
    hasMore: pageInfo.hasNextPage === true,
    cursor: readTrimmedString(pageInfo.endCursor) || null,
  };
}

function readIssueNodes(connection) {
  const nodes = isPlainObject(connection) ? connection.nodes : null;
  if (!Array.isArray(nodes)) return [];
  return nodes.map(readIssueSummary).filter(Boolean);
}

async function withLinearToken(run, workspaceId) {
  try {
    const token = await getValidLinearAccessToken(workspaceId);
    if (!token) {
      return { connected: false };
    }
    return await run(token);
  } catch (error) {
    if (error?.status === 401) {
      const failed = workspaceId
        ? getLinearAuthByWorkspaceId(workspaceId)
        : getLinearAuth();
      clearLinearAuth(failed?.workspaceId || workspaceId);
      return { connected: false };
    }
    throw error;
  }
}

async function fetchIssueByRef(token, ref) {
  const data = await fetchLinearGraphql(token, GET_QUERY, { id: ref.value });
  return readIssue(data.issue);
}

export async function listLinearIssues({ query, cursor } = {}) {
  return withLinearToken(async (token) => {
    const ref = parseLinearIssueRef(query);
    if (ref) {
      const issue = await fetchIssueByRef(token, ref);
      return {
        connected: true,
        issues: issue ? [issue] : [],
        cursor: null,
        hasMore: false,
      };
    }

    const after = readTrimmedString(cursor) || null;
    const term = readTrimmedString(query);
    const variables = {
      first: PAGE_SIZE,
      filter: INCOMPLETE_ISSUE_FILTER,
    };
    if (after) {
      variables.after = after;
    }

    if (term) {
      variables.term = term;
      const data = await fetchLinearGraphql(token, SEARCH_QUERY, variables);
      const connection = isPlainObject(data.searchIssues) ? data.searchIssues : null;
      const page = readPageInfo(connection);
      return {
        connected: true,
        issues: readIssueNodes(connection),
        cursor: page.cursor,
        hasMore: page.hasMore,
      };
    }

    const data = await fetchLinearGraphql(token, LIST_QUERY, variables);
    const connection = isPlainObject(data.issues) ? data.issues : null;
    const page = readPageInfo(connection);
    return {
      connected: true,
      issues: readIssueNodes(connection),
      cursor: page.cursor,
      hasMore: page.hasMore,
    };
  });
}

export async function getLinearIssue(id) {
  const ref = parseLinearIssueRef(id) || (readTrimmedString(id) ? { kind: 'id', value: readTrimmedString(id) } : null);
  if (!ref) {
    return { connected: true, issue: null };
  }
  return withLinearToken(async (token) => {
    const issue = await fetchIssueByRef(token, ref);
    return { connected: true, issue };
  });
}

export async function createLinearIssueComment({ issueId, body, organizationId } = {}) {
  const text = isString(body) ? body : '';
  const ref = parseLinearIssueRef(issueId)
    || (readTrimmedString(issueId) ? { kind: 'id', value: readTrimmedString(issueId) } : null);
  if (!ref || !text.trim()) {
    return { connected: true, comment: null };
  }
  return withLinearToken(async (token) => {
    const issue = await fetchIssueByRef(token, ref);
    if (!issue) {
      return { connected: true, comment: null };
    }
    const data = await fetchLinearGraphql(token, COMMENT_CREATE, {
      input: { issueId: issue.id, body: text },
    });
    const payload = isPlainObject(data.commentCreate) ? data.commentCreate : null;
    const comment = isPlainObject(payload?.comment) ? payload.comment : null;
    const id = comment ? readTrimmedString(comment.id) : '';
    return {
      connected: true,
      comment: id ? { id } : null,
    };
  }, organizationId);
}
