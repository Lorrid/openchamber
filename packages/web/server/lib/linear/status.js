import fs from 'fs';
import path from 'path';
import { getLinearAuth, getLinearAuthFilePath } from './auth.js';
import { createLinearIssueComment } from './issues.js';
import { isPlainObject, readEnv, readTrimmedString } from './parse.js';

const LINEAR_SESSION_STATUS_KINDS = ['started', 'completed', 'failure'];

export class LinearSessionStatusError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LinearSessionStatusError';
    this.code = code;
  }
}

const inflight = new Map();

function statusFile() {
  return path.join(path.dirname(getLinearAuthFilePath()), 'linear-session-status.json');
}

function writeJsonFile(filePath, payload) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
  try {
    fs.chmodSync(tmpFile, 0o600);
  } catch {
    // best-effort
  }
  fs.renameSync(tmpFile, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

function defaultLoopbackOrigin() {
  const port = readEnv('OPENCHAMBER_PORT') || '3000';
  return `http://127.0.0.1:${port}`;
}

export function readSessionOrigin(value) {
  const trimmed = readTrimmedString(value);
  if (!trimmed) return '';
  if (trimmed === 'openchamber:' || /^openchamber:/i.test(trimmed)) {
    return 'openchamber:';
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    if (url.search || url.hash) return '';
    if (url.pathname && url.pathname !== '/') return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function buildLinearSessionOpenUrl(sessionId, sessionOrigin) {
  const id = readTrimmedString(sessionId);
  const origin = readSessionOrigin(sessionOrigin);
  if (origin === 'openchamber:') {
    return `openchamber://session/${encodeURIComponent(id)}`;
  }
  return `${origin || defaultLoopbackOrigin()}/?session=${encodeURIComponent(id)}`;
}

function readSessionTitle(value) {
  const trimmed = readTrimmedString(value).replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
}

function escapeMarkdownLinkLabel(value) {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function statusWord(kind) {
  if (kind === 'started') return 'started';
  if (kind === 'completed') return 'completed';
  return 'failed';
}

export function buildLinearSessionStatusComment({ kind, sessionUrl, sessionTitle }) {
  const url = readTrimmedString(sessionUrl);
  const title = readSessionTitle(sessionTitle) || 'session';
  const label = `OpenChamber session ${statusWord(kind)}: ${title}`;
  if (!url) return label;
  // Linear comments are markdown. The whole line is the link so the click
  // keeps `?session=` and the visible text is the status plus session name.
  return `[${escapeMarkdownLinkLabel(label)}](${url})`;
}

function readBooleanFlag(value) {
  return value === true;
}

function readRecord(value) {
  if (!isPlainObject(value)) return null;
  const issueIdentifier = readTrimmedString(value.issueIdentifier);
  if (!issueIdentifier) return null;
  return {
    issueIdentifier,
    sessionOrigin: readSessionOrigin(value.sessionOrigin) || null,
    sessionTitle: readSessionTitle(value.sessionTitle) || null,
    organizationId: readTrimmedString(value.organizationId) || null,
    started: readBooleanFlag(value.started),
    completed: readBooleanFlag(value.completed),
    failure: readBooleanFlag(value.failure),
  };
}

function readRecords() {
  const filePath = statusFile();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  let parsed;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }
    parsed = JSON.parse(trimmed);
  } catch {
    throw new LinearSessionStatusError('Linear session status file is malformed', 'MALFORMED');
  }
  if (!isPlainObject(parsed)) {
    throw new LinearSessionStatusError('Linear session status file is malformed', 'MALFORMED');
  }
  const next = {};
  for (const key of Object.keys(parsed)) {
    const sessionId = readTrimmedString(key);
    const record = readRecord(parsed[key]);
    if (sessionId && record) {
      next[sessionId] = record;
    }
  }
  return next;
}

function writeRecords(records) {
  writeJsonFile(statusFile(), records);
}

async function postOnce(input) {
  const kind = readTrimmedString(input?.kind);
  const sessionId = readTrimmedString(input?.sessionId);
  if (!LINEAR_SESSION_STATUS_KINDS.includes(kind) || !sessionId) {
    throw new LinearSessionStatusError('kind and sessionId are required', 'INVALID');
  }

  const records = readRecords();
  const existing = records[sessionId] || null;
  if (existing?.[kind] === true) {
    return { connected: true, posted: false, skipped: 'already-posted' };
  }
  if (kind !== 'started' && existing?.started !== true) {
    return { connected: true, posted: false, skipped: 'not-started' };
  }

  const issueIdentifier = readTrimmedString(input?.issueIdentifier)
    || readTrimmedString(existing?.issueIdentifier);
  if (!issueIdentifier) {
    throw new LinearSessionStatusError('issueIdentifier is required', 'INVALID');
  }

  const sessionOrigin = readSessionOrigin(input?.sessionOrigin)
    || readTrimmedString(existing?.sessionOrigin);
  const sessionTitle = readSessionTitle(input?.sessionTitle)
    || readTrimmedString(existing?.sessionTitle)
    || sessionId;
  const sessionUrl = buildLinearSessionOpenUrl(sessionId, sessionOrigin);
  const organizationId = readTrimmedString(input?.organizationId)
    || readTrimmedString(existing?.organizationId)
    || readTrimmedString(getLinearAuth()?.workspaceId);
  const body = buildLinearSessionStatusComment({ kind, sessionUrl, sessionTitle });
  const commentResult = await createLinearIssueComment({
    issueId: issueIdentifier,
    body,
    organizationId,
  });
  if (commentResult.connected === false) {
    return { connected: false };
  }
  if (!commentResult.comment) {
    return { connected: true, posted: false, skipped: 'issue-not-found' };
  }

  records[sessionId] = {
    issueIdentifier,
    sessionOrigin: sessionOrigin || null,
    sessionTitle,
    organizationId: organizationId || null,
    started: existing?.started === true || kind === 'started',
    completed: existing?.completed === true || kind === 'completed',
    failure: existing?.failure === true || kind === 'failure',
  };
  writeRecords(records);
  return {
    connected: true,
    posted: true,
    commentId: commentResult.comment.id,
  };
}

export async function postLinearSessionStatus(input) {
  const kind = readTrimmedString(input?.kind);
  const sessionId = readTrimmedString(input?.sessionId);
  const key = `${sessionId}:${kind}`;
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const promise = postOnce(input).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
