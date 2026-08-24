import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getLinearAuth,
  setLinearAuth,
  clearLinearAuth,
  toLinearPublicStatus,
  getLinearClientId,
  getLinearRedirectUri,
  isLinearAccessTokenStale,
  getLinearAuthFilePath,
  DEFAULT_LINEAR_CLIENT_ID_VALUE,
} from './auth.js';

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-linear-auth-'));

describe('Linear auth storage', () => {
  let dataDir;
  let previousDataDir;
  let previousPort;
  let previousClientId;
  let previousRedirect;

  beforeEach(() => {
    previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
    previousPort = process.env.OPENCHAMBER_PORT;
    previousClientId = process.env.OPENCHAMBER_LINEAR_CLIENT_ID;
    previousRedirect = process.env.OPENCHAMBER_LINEAR_REDIRECT_URI;
    dataDir = makeTempDir();
    process.env.OPENCHAMBER_DATA_DIR = dataDir;
    delete process.env.OPENCHAMBER_LINEAR_CLIENT_ID;
    delete process.env.OPENCHAMBER_LINEAR_SCOPES;
    delete process.env.OPENCHAMBER_LINEAR_REDIRECT_URI;
    delete process.env.OPENCHAMBER_PORT;
  });

  afterEach(() => {
    restoreEnv('OPENCHAMBER_DATA_DIR', previousDataDir);
    restoreEnv('OPENCHAMBER_PORT', previousPort);
    restoreEnv('OPENCHAMBER_LINEAR_CLIENT_ID', previousClientId);
    restoreEnv('OPENCHAMBER_LINEAR_REDIRECT_URI', previousRedirect);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns disconnected when no auth file exists', () => {
    expect(getLinearAuth()).toBeNull();
    expect(toLinearPublicStatus(null)).toEqual({ connected: false });
  });

  it('persists tokens without exposing them on the public status', () => {
    setLinearAuth({
      accessToken: 'lin_oauth_access',
      refreshToken: 'lin_oauth_refresh',
      expiresAt: Date.now() + 60_000,
      scope: 'read,write',
      user: { id: 'user-1', name: 'Ada', displayName: 'Ada Lovelace', email: 'ada@example.com', avatarUrl: 'https://example.com/a.png' },
      organization: { id: 'org-1', name: 'OpenChamber', urlKey: 'openchamber' },
    });

    const stored = getLinearAuth();
    expect(stored.accessToken).toBe('lin_oauth_access');
    expect(stored.refreshToken).toBe('lin_oauth_refresh');
    expect(toLinearPublicStatus(stored)).toEqual({
      connected: true,
      user: {
        id: 'user-1',
        name: 'Ada',
        displayName: 'Ada Lovelace',
        email: 'ada@example.com',
        avatarUrl: 'https://example.com/a.png',
      },
      organization: { id: 'org-1', name: 'OpenChamber', urlKey: 'openchamber' },
      scope: 'read,write',
    });
    expect(JSON.stringify(toLinearPublicStatus(stored))).not.toContain('lin_oauth');
  });

  it('keeps the previous refresh token when a later write omits it', () => {
    setLinearAuth({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1,
    });
    setLinearAuth({
      accessToken: 'access-2',
      expiresAt: 2,
    });
    expect(getLinearAuth().refreshToken).toBe('refresh-1');
    expect(getLinearAuth().accessToken).toBe('access-2');
  });

  it('rotates the refresh token when a new one is provided', () => {
    setLinearAuth({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    setLinearAuth({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
    expect(getLinearAuth().refreshToken).toBe('refresh-2');
  });

  it('rejects a write without an access token', () => {
    expect(() => setLinearAuth({ refreshToken: 'refresh-1' })).toThrow('accessToken is required');
  });

  it('treats a missing or past expiry as stale', () => {
    expect(isLinearAccessTokenStale(null)).toBe(true);
    expect(isLinearAccessTokenStale(Date.now() - 1)).toBe(true);
    expect(isLinearAccessTokenStale(Date.now() + 10 * 60_000)).toBe(false);
  });

  it('uses the baked-in client id unless env or settings override it', () => {
    expect(getLinearClientId()).toBe(DEFAULT_LINEAR_CLIENT_ID_VALUE);
    process.env.OPENCHAMBER_LINEAR_CLIENT_ID = 'env-client';
    expect(getLinearClientId()).toBe('env-client');
  });

  it('builds the default redirect URI from the listen port', () => {
    process.env.OPENCHAMBER_PORT = '3001';
    expect(getLinearRedirectUri()).toBe('http://127.0.0.1:3001/linear/oauth/callback');
    process.env.OPENCHAMBER_LINEAR_REDIRECT_URI = 'http://localhost:3000/linear/oauth/callback';
    expect(getLinearRedirectUri()).toBe('http://localhost:3000/linear/oauth/callback');
  });

  it('deletes the auth file on clear', () => {
    setLinearAuth({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect(fs.existsSync(getLinearAuthFilePath())).toBe(true);
    expect(clearLinearAuth()).toBe(true);
    expect(fs.existsSync(getLinearAuthFilePath())).toBe(false);
    expect(getLinearAuth()).toBeNull();
  });
});

function restoreEnv(name, previous) {
  if (previous === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previous;
}
