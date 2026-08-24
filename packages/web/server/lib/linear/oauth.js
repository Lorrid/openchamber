import crypto from 'crypto';
import {
  getLinearClientId,
  getLinearClientSecret,
  getLinearRedirectUri,
  getLinearScopes,
} from './auth.js';
import { isPlainObject, isString, readFiniteNumber, readTrimmedString } from './parse.js';

export const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
export const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
export const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke';
export const PENDING_AUTHORIZATION_TTL_MS = 10 * 60_000;

const pendingByState = new Map();

export class LinearOAuthError extends Error {
  constructor(message, code = 'LINEAR_OAUTH_FAILED') {
    super(message);
    this.name = 'LinearOAuthError';
    this.code = code;
  }
}

export function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function pruneExpiredPending(now = Date.now()) {
  for (const [state, entry] of pendingByState.entries()) {
    if (!entry || entry.expiresAt <= now) {
      pendingByState.delete(state);
    }
  }
}

function normalizeScope(scope) {
  if (isString(scope)) {
    return scope.trim();
  }
  if (Array.isArray(scope)) {
    return scope.filter((item) => isString(item) && item.trim()).join(',');
  }
  return '';
}

function readExpiresAt(expiresIn, now = Date.now()) {
  const seconds = readFiniteNumber(expiresIn);
  if (seconds == null || seconds <= 0) {
    return now + 24 * 60 * 60 * 1000;
  }
  return now + Math.floor(seconds) * 1000;
}

function parseTokenPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new LinearOAuthError('Linear token response was empty');
  }
  if (readTrimmedString(payload.error)) {
    throw new LinearOAuthError(
      readTrimmedString(payload.error_description) || readTrimmedString(payload.error),
      readTrimmedString(payload.error).toUpperCase(),
    );
  }
  const accessToken = readTrimmedString(payload.access_token);
  if (!accessToken) {
    throw new LinearOAuthError('Linear token response was missing access_token');
  }
  return {
    accessToken,
    refreshToken: readTrimmedString(payload.refresh_token) || null,
    tokenType: readTrimmedString(payload.token_type) || 'bearer',
    expiresAt: readExpiresAt(payload.expires_in),
    scope: normalizeScope(payload.scope),
  };
}

async function postForm(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const description = isPlainObject(payload)
      ? (readTrimmedString(payload.error_description) || readTrimmedString(payload.error))
      : '';
    const error = new LinearOAuthError(
      description || `Linear token request failed (${response.status})`,
      readTrimmedString(payload?.error).toUpperCase() || 'LINEAR_OAUTH_FAILED',
    );
    error.status = response.status;
    throw error;
  }
  return parseTokenPayload(payload);
}

export function startAuthorization({ origin } = {}) {
  const clientId = getLinearClientId();
  if (!clientId) {
    throw new LinearOAuthError(
      'Linear OAuth client not configured. Set OPENCHAMBER_LINEAR_CLIENT_ID.',
      'LINEAR_CLIENT_ID_MISSING',
    );
  }

  pruneExpiredPending();
  const { verifier, challenge } = createPkcePair();
  const state = crypto.randomBytes(32).toString('base64url');
  const redirectUri = getLinearRedirectUri();
  const scope = getLinearScopes();
  pendingByState.set(state, {
    codeVerifier: verifier,
    redirectUri,
    origin: origin === 'desktop' ? 'desktop' : 'web',
    expiresAt: Date.now() + PENDING_AUTHORIZATION_TTL_MS,
  });

  const url = new URL(LINEAR_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('actor', 'user');
  url.searchParams.set('prompt', 'consent');

  return {
    authorizationUrl: url.toString(),
    expiresIn: Math.floor(PENDING_AUTHORIZATION_TTL_MS / 1000),
    scope,
  };
}

function failAuthorization(message, code, origin) {
  const error = new LinearOAuthError(message, code);
  if (origin) {
    error.origin = origin;
  }
  return error;
}

export async function consumeAuthorizationCallback({ code, state, error, errorDescription }) {
  pruneExpiredPending();
  const pending = readTrimmedString(state) ? pendingByState.get(state) : null;
  if (readTrimmedString(state)) {
    pendingByState.delete(state);
  }

  if (readTrimmedString(error)) {
    throw failAuthorization(
      readTrimmedString(errorDescription) || readTrimmedString(error),
      readTrimmedString(error).toUpperCase(),
      pending?.origin,
    );
  }
  if (!readTrimmedString(code)) {
    throw failAuthorization(
      'Linear did not return an authorization code.',
      'MISSING_CODE',
      pending?.origin,
    );
  }
  if (!pending?.codeVerifier) {
    throw failAuthorization(
      'This authorization session has expired or is unknown to the running app. Return to OpenChamber and click Connect again.',
      'UNKNOWN_STATE',
    );
  }

  const body = {
    grant_type: 'authorization_code',
    code: code.trim(),
    redirect_uri: pending.redirectUri,
    client_id: getLinearClientId(),
    code_verifier: pending.codeVerifier,
  };
  const clientSecret = getLinearClientSecret();
  if (clientSecret) {
    body.client_secret = clientSecret;
  }

  try {
    const tokens = await postForm(LINEAR_TOKEN_URL, body);
    return {
      ...tokens,
      origin: pending.origin,
    };
  } catch (caught) {
    if (caught instanceof Error) {
      caught.origin = pending.origin;
    }
    throw caught;
  }
}

export async function refreshAccessToken(refreshToken) {
  const token = readTrimmedString(refreshToken);
  if (!token) {
    throw new LinearOAuthError('refresh_token is required', 'MISSING_REFRESH_TOKEN');
  }
  const body = {
    grant_type: 'refresh_token',
    refresh_token: token,
    client_id: getLinearClientId(),
  };
  const clientSecret = getLinearClientSecret();
  if (clientSecret) {
    body.client_secret = clientSecret;
  }
  return postForm(LINEAR_TOKEN_URL, body);
}

export async function revokeToken(token, tokenTypeHint) {
  const value = readTrimmedString(token);
  if (!value) {
    return false;
  }
  const body = { token: value };
  if (tokenTypeHint === 'access_token' || tokenTypeHint === 'refresh_token') {
    body.token_type_hint = tokenTypeHint;
  }
  try {
    const response = await fetch(LINEAR_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export function clearPendingAuthorizationsForTests() {
  pendingByState.clear();
}
