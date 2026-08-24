import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setLinearAuth, clearLinearAuth } from './auth.js';
import {
  buildLinearSessionOpenUrl,
  buildLinearSessionStatusComment,
  postLinearSessionStatus,
  readSessionOrigin,
} from './status.js';

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-linear-status-'));

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const issueNode = {
  id: 'issue-uuid-1',
  identifier: 'ENG-12',
  title: 'Broken login',
  url: 'https://linear.app/openchamber/issue/ENG-12',
  state: { name: 'In Progress', type: 'started' },
  assignee: null,
  team: { id: 'team-eng', key: 'ENG', name: 'Engineering' },
  description: null,
  comments: { nodes: [] },
};

function stubLinearGraphql({ commentId = 'comment-1' } = {}) {
  return vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.query.includes('query GetLinearIssue')) {
      return jsonResponse({ data: { issue: issueNode } });
    }
    if (body.query.includes('mutation CommentCreate')) {
      expect(body.variables.input.issueId).toBe('issue-uuid-1');
      expect(body.variables.input.body).toContain('/?session=ses_1');
      return jsonResponse({
        data: {
          commentCreate: {
            success: true,
            comment: { id: commentId },
          },
        },
      });
    }
    throw new Error(`unexpected query: ${body.query}`);
  });
}

describe('Linear session status comments', () => {
  let dataDir;
  let previousDataDir;
  let previousPort;

  beforeEach(() => {
    previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
    previousPort = process.env.OPENCHAMBER_PORT;
    dataDir = makeTempDir();
    process.env.OPENCHAMBER_DATA_DIR = dataDir;
    process.env.OPENCHAMBER_PORT = '3001';
    setLinearAuth({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 86_400_000,
      scope: 'read,write,comments:create',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearLinearAuth();
    if (previousDataDir === undefined) {
      delete process.env.OPENCHAMBER_DATA_DIR;
    } else {
      process.env.OPENCHAMBER_DATA_DIR = previousDataDir;
    }
    if (previousPort === undefined) {
      delete process.env.OPENCHAMBER_PORT;
    } else {
      process.env.OPENCHAMBER_PORT = previousPort;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('reads http(s) origins and rejects other URLs', () => {
    expect(readSessionOrigin('https://app.example.com')).toBe('https://app.example.com');
    expect(readSessionOrigin('http://127.0.0.1:3001/')).toBe('http://127.0.0.1:3001');
    expect(readSessionOrigin('javascript:alert(1)')).toBe('');
    expect(readSessionOrigin('https://app.example.com/secret')).toBe('');
    expect(readSessionOrigin('openchamber:')).toBe('openchamber:');
    expect(buildLinearSessionOpenUrl('ses_1', 'https://app.example.com'))
      .toBe('https://app.example.com/?session=ses_1');
    expect(buildLinearSessionOpenUrl('ses_1', '')).toBe('http://127.0.0.1:3001/?session=ses_1');
    expect(buildLinearSessionOpenUrl('ses_1', 'openchamber:'))
      .toBe('openchamber://session/ses_1');
  });

  it('names the comment with status and session title as the open link', () => {
    expect(buildLinearSessionStatusComment({
      kind: 'started',
      sessionUrl: 'https://app.example.com/?session=ses_1',
      sessionTitle: 'ENG-12 Broken login',
    })).toBe('[OpenChamber session started: ENG-12 Broken login](https://app.example.com/?session=ses_1)');
    expect(buildLinearSessionStatusComment({
      kind: 'completed',
      sessionUrl: 'https://app.example.com/?session=ses_1',
      sessionTitle: 'ENG-12 Broken login',
    })).toBe('[OpenChamber session completed: ENG-12 Broken login](https://app.example.com/?session=ses_1)');
    expect(buildLinearSessionStatusComment({
      kind: 'failure',
      sessionUrl: 'https://app.example.com/?session=ses_1',
      sessionTitle: 'ENG-12 Broken login',
    })).toBe('[OpenChamber session failed: ENG-12 Broken login](https://app.example.com/?session=ses_1)');
  });

  it('returns disconnected without calling Linear when there is no auth', async () => {
    clearLinearAuth();
    const graphql = vi.fn();
    vi.stubGlobal('fetch', graphql);
    await expect(postLinearSessionStatus({
      kind: 'started',
      sessionId: 'ses_1',
      issueIdentifier: 'ENG-12',
    })).resolves.toEqual({ connected: false });
    expect(graphql).not.toHaveBeenCalled();
  });

  it('posts a started comment once and skips repeats', async () => {
    const graphql = stubLinearGraphql();
    vi.stubGlobal('fetch', graphql);

    const first = await postLinearSessionStatus({
      kind: 'started',
      sessionId: 'ses_1',
      issueIdentifier: 'ENG-12',
      sessionOrigin: 'https://app.example.com',
      sessionTitle: 'ENG-12 Broken login',
    });
    expect(first).toEqual({ connected: true, posted: true, commentId: 'comment-1' });

    const second = await postLinearSessionStatus({
      kind: 'started',
      sessionId: 'ses_1',
      issueIdentifier: 'ENG-12',
      sessionOrigin: 'https://app.example.com',
    });
    expect(second).toEqual({ connected: true, posted: false, skipped: 'already-posted' });

    const commentCalls = graphql.mock.calls.filter(([, options]) => {
      return JSON.parse(options.body).query.includes('mutation CommentCreate');
    });
    expect(commentCalls).toHaveLength(1);
    const body = JSON.parse(commentCalls[0][1].body).variables.input.body;
    expect(body).toBe('[OpenChamber session started: ENG-12 Broken login](https://app.example.com/?session=ses_1)');
    expect(JSON.stringify(first)).not.toContain('access-1');
  });

  it('skips completed until started has been posted', async () => {
    const graphql = stubLinearGraphql();
    vi.stubGlobal('fetch', graphql);
    await expect(postLinearSessionStatus({
      kind: 'completed',
      sessionId: 'ses_1',
    })).resolves.toEqual({ connected: true, posted: false, skipped: 'not-started' });
    expect(graphql).not.toHaveBeenCalled();
  });

  it('posts completed once after started, reusing the stored open URL', async () => {
    vi.stubGlobal('fetch', stubLinearGraphql({ commentId: 'comment-started' }));
    await postLinearSessionStatus({
      kind: 'started',
      sessionId: 'ses_1',
      issueIdentifier: 'ENG-12',
      sessionOrigin: 'https://app.example.com',
      sessionTitle: 'ENG-12 Broken login',
    });

    const graphql = stubLinearGraphql({ commentId: 'comment-done' });
    vi.stubGlobal('fetch', graphql);
    const first = await postLinearSessionStatus({ kind: 'completed', sessionId: 'ses_1' });
    expect(first).toEqual({ connected: true, posted: true, commentId: 'comment-done' });
    const second = await postLinearSessionStatus({ kind: 'completed', sessionId: 'ses_1' });
    expect(second).toEqual({ connected: true, posted: false, skipped: 'already-posted' });

    const commentCalls = graphql.mock.calls.filter(([, options]) => {
      return JSON.parse(options.body).query.includes('mutation CommentCreate');
    });
    expect(commentCalls).toHaveLength(1);
    const body = JSON.parse(commentCalls[0][1].body).variables.input.body;
    expect(body).toBe('[OpenChamber session completed: ENG-12 Broken login](https://app.example.com/?session=ses_1)');
  });
});
