import {
  getLinearAuth,
  getLinearAuthByWorkspaceId,
  setLinearAuth,
  clearLinearAuth,
  isLinearAccessTokenStale,
} from './auth.js';
import { refreshAccessToken } from './oauth.js';
import { isPlainObject, readTrimmedString } from './parse.js';

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
const VIEWER_QUERY = '{ viewer { id name displayName email avatarUrl } organization { id name urlKey } }';

export class LinearApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'LinearApiError';
    this.status = status;
  }
}

function readIdentity(payload) {
  const data = isPlainObject(payload) ? payload.data : null;
  const viewer = isPlainObject(data) ? data.viewer : null;
  if (!isPlainObject(viewer) || !readTrimmedString(viewer.id)) {
    return null;
  }
  const organization = isPlainObject(data) ? data.organization : null;
  const organizationId = isPlainObject(organization) ? readTrimmedString(organization.id) : '';
  const organizationName = isPlainObject(organization) ? readTrimmedString(organization.name) : '';
  return {
    user: {
      id: viewer.id.trim(),
      name: readTrimmedString(viewer.name) || null,
      displayName: readTrimmedString(viewer.displayName) || null,
      email: readTrimmedString(viewer.email) || null,
      avatarUrl: readTrimmedString(viewer.avatarUrl) || null,
    },
    organization: organizationId && organizationName
      ? {
        id: organizationId,
        name: organizationName,
        urlKey: readTrimmedString(organization.urlKey) || null,
      }
      : null,
  };
}

export async function fetchLinearGraphql(accessToken, query, variables) {
  const token = readTrimmedString(accessToken);
  if (!token) {
    throw new LinearApiError('Linear is not connected', 401);
  }

  const body = { query };
  if (isPlainObject(variables)) {
    body.variables = variables;
  }

  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    throw new LinearApiError('Linear token expired or revoked', 401);
  }
  if (!response.ok) {
    throw new LinearApiError(`Linear GraphQL request failed (${response.status})`, response.status);
  }
  if (!isPlainObject(payload)) {
    throw new LinearApiError('Linear GraphQL response was not JSON', 502);
  }
  const data = isPlainObject(payload.data) ? payload.data : null;
  if (!data) {
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const first = errors.length > 0 && isPlainObject(errors[0])
      ? readTrimmedString(errors[0].message)
      : '';
    throw new LinearApiError(first || 'Linear GraphQL response did not include data', 502);
  }
  return data;
}

export async function fetchLinearIdentity(accessToken) {
  const data = await fetchLinearGraphql(accessToken, VIEWER_QUERY);
  const identity = readIdentity({ data });
  if (!identity) {
    throw new LinearApiError('Linear GraphQL response did not include a viewer', 502);
  }
  return identity;
}

const inFlightRefreshByWorkspace = new Map();

async function refreshWorkspaceAuth(auth) {
  const tokens = await refreshAccessToken(auth.refreshToken);
  const next = setLinearAuth({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || auth.refreshToken,
    tokenType: tokens.tokenType,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope || auth.scope,
    user: auth.user,
    organization: auth.organization,
    workspaceId: auth.workspaceId,
  }, { activate: false });
  return next.accessToken;
}

export async function getValidLinearAccessToken(workspaceId) {
  const auth = workspaceId
    ? getLinearAuthByWorkspaceId(workspaceId)
    : getLinearAuth();
  if (!auth?.accessToken) {
    return null;
  }
  if (!isLinearAccessTokenStale(auth.expiresAt)) {
    return auth.accessToken;
  }
  if (!auth.refreshToken) {
    clearLinearAuth(auth.workspaceId);
    return null;
  }
  const key = auth.workspaceId;
  const pending = inFlightRefreshByWorkspace.get(key);
  if (pending) {
    return pending;
  }
  const promise = refreshWorkspaceAuth(auth)
    .catch((error) => {
      if (error?.code === 'INVALID_GRANT' || error?.status === 400 || error?.status === 401) {
        clearLinearAuth(auth.workspaceId);
        return null;
      }
      throw error;
    })
    .finally(() => {
      inFlightRefreshByWorkspace.delete(key);
    });
  inFlightRefreshByWorkspace.set(key, promise);
  return promise;
}
