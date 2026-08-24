import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setLinearAuth } from './auth.js';
import {
  getLinearMappingFilePath,
  mergeLinearMappingView,
  readStoredLinearMapping,
  resolveMappedProjectPath,
  setStoredLinearMapping,
} from './mapping.js';

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-linear-mapping-'));

describe('Linear project mapping storage', () => {
  let dataDir;
  let previousDataDir;

  beforeEach(() => {
    previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
    dataDir = makeTempDir();
    process.env.OPENCHAMBER_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (previousDataDir === undefined) {
      delete process.env.OPENCHAMBER_DATA_DIR;
    } else {
      process.env.OPENCHAMBER_DATA_DIR = previousDataDir;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('treats a missing file as empty mapping, not a failure', () => {
    expect(fs.existsSync(getLinearMappingFilePath())).toBe(false);
    expect(readStoredLinearMapping()).toEqual({
      defaultProjectPath: null,
      teamProjectPaths: {},
    });
  });

  it('round-trips a default project and per-team paths', () => {
    const written = setStoredLinearMapping({
      defaultProjectPath: '/Users/ada/openchamber',
      teamProjectPaths: {
        'team-eng': '/Users/ada/eng',
        'team-empty': '   ',
      },
    });
    expect(written).toEqual({
      defaultProjectPath: '/Users/ada/openchamber',
      teamProjectPaths: { 'team-eng': '/Users/ada/eng' },
    });
    expect(readStoredLinearMapping()).toEqual(written);
    expect(fs.statSync(getLinearMappingFilePath()).mode & 0o777).toBe(0o600);
  });

  it('replaces the previous mapping on write', () => {
    setStoredLinearMapping({
      defaultProjectPath: '/old',
      teamProjectPaths: { 'team-eng': '/eng' },
    });
    const next = setStoredLinearMapping({
      defaultProjectPath: null,
      teamProjectPaths: {},
    });
    expect(next).toEqual({ defaultProjectPath: null, teamProjectPaths: {} });
    expect(readStoredLinearMapping()).toEqual(next);
  });

  it('keeps tokens when a mapping write is rejected', () => {
    setLinearAuth({
      accessToken: 'access-keep',
      refreshToken: 'refresh-keep',
      expiresAt: Date.now() + 60_000,
    });
    setStoredLinearMapping({
      defaultProjectPath: '/keep',
      teamProjectPaths: { 'team-eng': '/eng' },
    });
    expect(() => setStoredLinearMapping(null)).toThrow(/object/);
    expect(readStoredLinearMapping()).toEqual({
      defaultProjectPath: '/keep',
      teamProjectPaths: { 'team-eng': '/eng' },
    });
    const authPath = path.join(dataDir, 'linear-auth.json');
    expect(JSON.parse(fs.readFileSync(authPath, 'utf8')).accessToken).toBe('access-keep');
  });

  it('rejects a malformed mapping file instead of treating it as empty', () => {
    fs.writeFileSync(getLinearMappingFilePath(), '{not-json', 'utf8');
    expect(() => readStoredLinearMapping()).toThrow(/malformed/);
  });

  it('merges live teams onto stored paths and resolves team then default', () => {
    const stored = {
      defaultProjectPath: '/default',
      teamProjectPaths: { 'team-eng': '/eng' },
    };
    const view = mergeLinearMappingView(stored, [
      { id: 'team-eng', key: 'ENG', name: 'Engineering' },
      { id: 'team-des', key: 'DES', name: 'Design' },
    ]);
    expect(view).toEqual({
      defaultProjectPath: '/default',
      teams: [
        { id: 'team-eng', key: 'ENG', name: 'Engineering', projectPath: '/eng' },
        { id: 'team-des', key: 'DES', name: 'Design', projectPath: null },
      ],
    });
    expect(resolveMappedProjectPath(view, { id: 'team-eng', key: 'ENG' })).toBe('/eng');
    expect(resolveMappedProjectPath(view, { id: 'team-des', key: 'DES' })).toBe('/default');
    expect(resolveMappedProjectPath(view, null)).toBe('/default');
  });
});
