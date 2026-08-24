import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setLinearAuth, clearLinearAuth } from './auth.js';
import { getLinearIssue, listLinearIssues, parseLinearIssueRef, createLinearIssueComment } from './issues.js';

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-linear-issues-'));

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
  assignee: { name: 'Ada', displayName: 'Ada Lovelace', avatarUrl: 'https://example.com/a.png' },
  team: { id: 'team-eng', key: 'ENG', name: 'Engineering' },
};

describe('parseLinearIssueRef', () => {
  it('reads identifiers, URLs, and UUIDs', () => {
    expect(parseLinearIssueRef('eng-12')).toEqual({ kind: 'identifier', value: 'ENG-12' });
    expect(parseLinearIssueRef('https://linear.app/openchamber/issue/ENG-12/broken-login'))
      .toEqual({ kind: 'identifier', value: 'ENG-12' });
    expect(parseLinearIssueRef('11111111-2222-3333-4444-555555555555'))
      .toEqual({ kind: 'id', value: '11111111-2222-3333-4444-555555555555' });
    expect(parseLinearIssueRef('login redirect')).toBeNull();
  });
});

describe('Linear issue list/get', () => {
  let dataDir;
  let previousDataDir;

  beforeEach(() => {
    previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
    dataDir = makeTempDir();
    process.env.OPENCHAMBER_DATA_DIR = dataDir;
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
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns disconnected without calling Linear when there is no auth', async () => {
    clearLinearAuth();
    const graphql = vi.fn();
    vi.stubGlobal('fetch', graphql);
    await expect(listLinearIssues()).resolves.toEqual({ connected: false });
    expect(graphql).not.toHaveBeenCalled();
  });

  it('lists incomplete issues and never returns the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      expect(body.query).toContain('query ListLinearIssues');
      expect(body.variables.filter.state.type.nin).toEqual(['completed', 'canceled']);
      expect(options.headers.Authorization).toBe('Bearer access-1');
      return jsonResponse({
        data: {
          issues: {
            nodes: [issueNode],
            pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
          },
        },
      });
    }));

    const result = await listLinearIssues();
    expect(result).toEqual({
      connected: true,
      issues: [{
        id: 'issue-uuid-1',
        identifier: 'ENG-12',
        title: 'Broken login',
        url: 'https://linear.app/openchamber/issue/ENG-12',
        state: { name: 'In Progress', type: 'started' },
        assignee: { name: 'Ada', displayName: 'Ada Lovelace', avatarUrl: 'https://example.com/a.png' },
        team: { id: 'team-eng', key: 'ENG', name: 'Engineering' },
      }],
      cursor: 'cursor-2',
      hasMore: true,
    });
    expect(JSON.stringify(result)).not.toContain('access-1');
  });

  it('searches by text and looks up an identifier directly', async () => {
    const graphql = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('SearchLinearIssues')) {
        expect(body.variables.term).toBe('login');
        return jsonResponse({
          data: {
            searchIssues: {
              nodes: [issueNode],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      expect(body.variables.id).toBe('ENG-12');
      return jsonResponse({
        data: {
          issue: {
            ...issueNode,
            description: 'Users cannot sign in.',
            comments: {
              nodes: [{
                id: 'comment-1',
                body: 'Still broken',
                createdAt: '2026-08-24T10:00:00.000Z',
                user: { name: 'Ada', displayName: 'Ada Lovelace' },
              }],
            },
          },
        },
      });
    });
    vi.stubGlobal('fetch', graphql);

    const search = await listLinearIssues({ query: 'login' });
    expect(search.issues).toHaveLength(1);
    expect(search.hasMore).toBe(false);

    const byId = await listLinearIssues({ query: 'https://linear.app/openchamber/issue/ENG-12' });
    expect(byId.issues?.[0]?.identifier).toBe('ENG-12');
    expect(byId.hasMore).toBe(false);
  });

  it('loads one issue with comments', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      data: {
        issue: {
          ...issueNode,
          description: 'Users cannot sign in.',
          comments: { nodes: [{ id: 'comment-1', body: 'Still broken', createdAt: '2026-08-24T10:00:00.000Z', user: { name: 'Ada', displayName: null } }] },
        },
      },
    })));

    const result = await getLinearIssue('ENG-12');
    expect(result.connected).toBe(true);
    expect(result.issue?.description).toBe('Users cannot sign in.');
    expect(result.issue?.comments).toEqual([{
      id: 'comment-1',
      body: 'Still broken',
      createdAt: '2026-08-24T10:00:00.000Z',
      user: { name: 'Ada', displayName: null },
    }]);
  });

  it('creates a comment on the resolved issue UUID', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('query GetLinearIssue')) {
        expect(body.variables.id).toBe('ENG-12');
        return jsonResponse({
          data: {
            issue: {
              ...issueNode,
              description: null,
              comments: { nodes: [] },
            },
          },
        });
      }
      expect(body.query).toContain('mutation CommentCreate');
      expect(body.variables.input).toEqual({
        issueId: 'issue-uuid-1',
        body: 'OpenChamber session started.',
      });
      expect(options.headers.Authorization).toBe('Bearer access-1');
      return jsonResponse({
        data: {
          commentCreate: {
            success: true,
            comment: { id: 'comment-9' },
          },
        },
      });
    }));

    const result = await createLinearIssueComment({
      issueId: 'ENG-12',
      body: 'OpenChamber session started.',
    });
    expect(result).toEqual({ connected: true, comment: { id: 'comment-9' } });
    expect(JSON.stringify(result)).not.toContain('access-1');
  });

  it('clears auth and reports disconnected after a GraphQL 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ errors: [{ message: 'Unauthorized' }] }, 401)));
    await expect(listLinearIssues()).resolves.toEqual({ connected: false });
    await expect(listLinearIssues()).resolves.toEqual({ connected: false });
  });
});
