import fs from 'fs';
import path from 'path';
import os from 'os';
import { isPlainObject, readEnv, readFiniteNumber, readTrimmedString } from './parse.js';

const DEFAULT_LINEAR_CLIENT_ID = '91bbe26a69a2c8568d3683f1e01e776c';
const DEFAULT_LINEAR_SCOPES = 'read,write,comments:create';
const ACCESS_TOKEN_REFRESH_SKEW_MS = 2 * 60_000;

function resolveDataDir() {
  const fromEnv = readEnv('OPENCHAMBER_DATA_DIR');
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(os.homedir(), '.config', 'openchamber');
}

function storageFile() {
  return path.join(resolveDataDir(), 'linear-auth.json');
}

function settingsFile() {
  return path.join(resolveDataDir(), 'settings.json');
}

function ensureStorageDir() {
  const dir = resolveDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = JSON.parse(trimmed);
    if (!isPlainObject(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error('Failed to read Linear auth file:', error);
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  ensureStorageDir();
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

function normalizeUser(user) {
  if (!isPlainObject(user)) {
    return null;
  }
  const id = readTrimmedString(user.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: readTrimmedString(user.name) || null,
    displayName: readTrimmedString(user.displayName) || null,
    email: readTrimmedString(user.email) || null,
    avatarUrl: readTrimmedString(user.avatarUrl) || null,
  };
}

function normalizeOrganization(organization) {
  if (!isPlainObject(organization)) {
    return null;
  }
  const id = readTrimmedString(organization.id);
  const name = readTrimmedString(organization.name);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    urlKey: readTrimmedString(organization.urlKey) || null,
  };
}

function normalizeAuth(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const accessToken = readTrimmedString(raw.accessToken);
  if (!accessToken) {
    return null;
  }
  return {
    accessToken,
    refreshToken: readTrimmedString(raw.refreshToken) || null,
    tokenType: readTrimmedString(raw.tokenType) || 'bearer',
    expiresAt: readFiniteNumber(raw.expiresAt),
    scope: readTrimmedString(raw.scope),
    createdAt: readFiniteNumber(raw.createdAt),
    user: normalizeUser(raw.user),
    organization: normalizeOrganization(raw.organization),
  };
}

function readSettings() {
  return readJsonFile(settingsFile()) || {};
}

function readSettingString(key) {
  const stored = readSettings()[key];
  return readTrimmedString(stored);
}

export function getLinearAuth() {
  return normalizeAuth(readJsonFile(storageFile()));
}

export function setLinearAuth(input) {
  const accessToken = readTrimmedString(input?.accessToken);
  if (!accessToken) {
    throw new Error('accessToken is required');
  }
  const previous = getLinearAuth();
  const next = {
    accessToken,
    refreshToken: Object.prototype.hasOwnProperty.call(input, 'refreshToken')
      ? (readTrimmedString(input.refreshToken) || null)
      : previous?.refreshToken || null,
    tokenType: readTrimmedString(input?.tokenType) || previous?.tokenType || 'bearer',
    expiresAt: readFiniteNumber(input?.expiresAt) ?? previous?.expiresAt ?? null,
    scope: readTrimmedString(input?.scope) || previous?.scope || '',
    createdAt: previous?.createdAt || Date.now(),
    user: Object.prototype.hasOwnProperty.call(input, 'user')
      ? normalizeUser(input.user)
      : previous?.user || null,
    organization: Object.prototype.hasOwnProperty.call(input, 'organization')
      ? normalizeOrganization(input.organization)
      : previous?.organization || null,
  };
  writeJsonFile(storageFile(), next);
  return next;
}

export function clearLinearAuth() {
  try {
    const filePath = storageFile();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (error) {
    console.error('Failed to clear Linear auth file:', error);
    return false;
  }
}

export function isLinearAccessTokenStale(expiresAt, now = Date.now()) {
  const expiry = readFiniteNumber(expiresAt);
  if (expiry == null) {
    return true;
  }
  return expiry - ACCESS_TOKEN_REFRESH_SKEW_MS <= now;
}

export function toLinearPublicStatus(auth) {
  if (!auth?.accessToken) {
    return { connected: false };
  }
  return {
    connected: true,
    user: auth.user || null,
    organization: auth.organization || null,
    scope: auth.scope || undefined,
  };
}

export function getLinearClientId() {
  const fromEnv = readEnv('OPENCHAMBER_LINEAR_CLIENT_ID');
  if (fromEnv) return fromEnv;
  const stored = readSettingString('linearClientId');
  if (stored) return stored;
  return DEFAULT_LINEAR_CLIENT_ID;
}

export function getLinearClientSecret() {
  const fromEnv = readEnv('OPENCHAMBER_LINEAR_CLIENT_SECRET');
  if (fromEnv) return fromEnv;
  return readSettingString('linearClientSecret');
}

export function getLinearScopes() {
  const fromEnv = readEnv('OPENCHAMBER_LINEAR_SCOPES');
  if (fromEnv) return fromEnv;
  const stored = readSettingString('linearScopes');
  if (stored) return stored;
  return DEFAULT_LINEAR_SCOPES;
}

function readPositivePort(value) {
  const trimmed = readTrimmedString(value);
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  return port;
}

function readArgPort() {
  const index = process.argv.indexOf('--port');
  if (index < 0) return null;
  return readPositivePort(process.argv[index + 1]);
}

export function getLinearRedirectUri() {
  const fromEnv = readEnv('OPENCHAMBER_LINEAR_REDIRECT_URI');
  if (fromEnv) return fromEnv;
  const stored = readSettingString('linearRedirectUri');
  if (stored) return stored;
  const port = readPositivePort(process.env.OPENCHAMBER_PORT) ?? readArgPort() ?? 3000;
  return `http://127.0.0.1:${port}/linear/oauth/callback`;
}

export function getLinearAuthFilePath() {
  return storageFile();
}
export const DEFAULT_LINEAR_CLIENT_ID_VALUE = DEFAULT_LINEAR_CLIENT_ID;
export const DEFAULT_LINEAR_SCOPES_VALUE = DEFAULT_LINEAR_SCOPES;
