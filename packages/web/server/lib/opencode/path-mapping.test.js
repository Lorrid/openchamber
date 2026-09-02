import { afterEach, describe, expect, it } from 'vitest';

import {
  createPathMapping,
  getPathMapping,
  parsePathMappingRules,
  setActivePathMapping,
} from './path-mapping.js';

const silentLogger = { warn: () => undefined, error: () => undefined, log: () => undefined };

describe('parsePathMappingRules', () => {
  it('returns zero rules for unset or blank values', () => {
    expect(parsePathMappingRules(undefined, { logger: silentLogger }).rules).toEqual([]);
    expect(parsePathMappingRules('', { logger: silentLogger }).rules).toEqual([]);
    expect(parsePathMappingRules('   ', { logger: silentLogger }).rules).toEqual([]);
  });

  it('parses a single host=remote pair on Windows hosts', () => {
    const { rules } = parsePathMappingRules('C:\\Users\\me\\projem=/workspace', {
      platform: 'win32',
      logger: silentLogger,
    });

    expect(rules).toEqual([
      { hostPrefix: 'C:\\Users\\me\\projem', remotePrefix: '/workspace', compareKey: 'c:\\users\\me\\projem' },
    ]);
  });

  it('parses multiple pairs and sorts for longest-prefix matching', () => {
    const { rules } = parsePathMappingRules('C:\\short=/ws;C:\\shorter\\nested=/deep', {
      platform: 'win32',
      logger: silentLogger,
    });

    expect(rules.map((rule) => rule.remotePrefix)).toEqual(['/deep', '/ws']);
  });

  it('accepts POSIX host paths on POSIX platforms', () => {
    const { rules } = parsePathMappingRules('/home/me/projem=/workspace', {
      platform: 'linux',
      logger: silentLogger,
    });

    expect(rules).toEqual([{ hostPrefix: '/home/me/projem', remotePrefix: '/workspace', compareKey: '/home/me/projem' }]);
  });

  it('keeps valid pairs and warns about invalid ones', () => {
    const warnings = [];
    const { rules, warnings: collected } = parsePathMappingRules(
      [
        'C:\\valid=/workspace',
        'relative/path=/workspace',
        'C:\\noRemote=',
        '=C:\\noHost',
        'C:\\noPairChar',
        'C:\\posixOnly=workspace',
        '',
      ].join(';'),
      { platform: 'win32', logger: { warn: (message) => warnings.push(message) } },
    );

    expect(rules).toHaveLength(1);
    expect(rules[0].remotePrefix).toBe('/workspace');
    expect(collected).toHaveLength(5);
    expect(warnings.every((message) => message.includes('OPENCODE_PATH_MAP'))).toBe(true);
  });

  it('rejects a host path that is absolute only on the other platform', () => {
    const { rules } = parsePathMappingRules('/home/me/projem=/workspace', {
      platform: 'win32',
      logger: silentLogger,
    });

    expect(rules).toEqual([]);
  });

  it('strips trailing separators so prefix matching stays consistent', () => {
    const { rules } = parsePathMappingRules('C:\\Users\\me\\projem\\=/workspace/', {
      platform: 'win32',
      logger: silentLogger,
    });

    expect(rules[0]).toMatchObject({ hostPrefix: 'C:\\Users\\me\\projem', remotePrefix: '/workspace' });
  });

  it('overrides duplicate host prefixes with a warning', () => {
    const warnings = [];
    const { rules } = parsePathMappingRules('C:\\proj=/first;C:\\proj=/second', {
      platform: 'win32',
      logger: { warn: (message) => warnings.push(message) },
    });

    expect(rules).toHaveLength(1);
    expect(rules[0].remotePrefix).toBe('/second');
    expect(warnings.some((message) => message.includes('duplicate host prefix'))).toBe(true);
  });
});

describe('createPathMapping.toRemote', () => {
  const windowsMapping = createPathMapping({
    platform: 'win32',
    rules: [{ hostPrefix: 'C:\\Users\\me\\projem', remotePrefix: '/workspace', compareKey: 'c:\\users\\me\\projem' }],
  });

  it('is identity when no rules exist', () => {
    const mapping = createPathMapping({ platform: 'win32', rules: [] });

    expect(mapping.enabled).toBe(false);
    expect(mapping.toRemote('C:\\anywhere\\file.ts')).toBe('C:\\anywhere\\file.ts');
    expect(mapping.toHost('/workspace/file.ts')).toBe('/workspace/file.ts');
  });

  it('maps the exact prefix', () => {
    expect(windowsMapping.toRemote('C:\\Users\\me\\projem')).toBe('/workspace');
  });

  it('maps nested paths and normalizes separators', () => {
    expect(windowsMapping.toRemote('C:\\Users\\me\\projem\\src\\app.ts')).toBe('/workspace/src/app.ts');
    expect(windowsMapping.toRemote('C:/Users/me/projem/src/app.ts')).toBe('/workspace/src/app.ts');
  });

  it('matches prefixes case-insensitively on Windows hosts', () => {
    expect(windowsMapping.toRemote('c:\\users\\me\\PROJEM\\src')).toBe('/workspace/src');
  });

  it('does not claim paths that merely share a prefix string', () => {
    expect(windowsMapping.toRemote('C:\\Users\\me\\projemExtra\\file.ts')).toBe('C:\\Users\\me\\projemExtra\\file.ts');
  });

  it('passes through unmapped host paths untouched', () => {
    expect(windowsMapping.toRemote('C:\\other\\project')).toBe('C:\\other\\project');
  });

  it('fails closed on parent-directory segments inside the mapped suffix', () => {
    expect(windowsMapping.toRemote('C:\\Users\\me\\projem\\..\\secret')).toBe('C:\\Users\\me\\projem\\..\\secret');
    expect(windowsMapping.toRemote('C:\\Users\\me\\projem\\src\\..\\app.ts')).toBe('C:\\Users\\me\\projem\\src\\..\\app.ts');
  });

  it('is case-sensitive on POSIX hosts', () => {
    const mapping = createPathMapping({
      platform: 'linux',
      rules: [{ hostPrefix: '/home/me/projem', remotePrefix: '/workspace', compareKey: '/home/me/projem' }],
    });

    expect(mapping.toRemote('/home/me/Projem/src')).toBe('/home/me/Projem/src');
    expect(mapping.toRemote('/home/me/projem/src')).toBe('/workspace/src');
  });
});

describe('createPathMapping.toHost', () => {
  const windowsMapping = createPathMapping({
    platform: 'win32',
    rules: [{ hostPrefix: 'C:\\Users\\me\\projem', remotePrefix: '/workspace', compareKey: 'c:\\users\\me\\projem' }],
  });

  it('maps the exact remote prefix back to the host path', () => {
    expect(windowsMapping.toHost('/workspace')).toBe('C:\\Users\\me\\projem');
  });

  it('maps nested remote paths back with host separators', () => {
    expect(windowsMapping.toHost('/workspace/src/app.ts')).toBe('C:\\Users\\me\\projem\\src\\app.ts');
  });

  it('does not claim remote paths that merely share a prefix string', () => {
    expect(windowsMapping.toHost('/workspaceExtra/file.ts')).toBe('/workspaceExtra/file.ts');
  });

  it('passes through unmapped remote paths untouched', () => {
    expect(windowsMapping.toHost('/srv/other/file.ts')).toBe('/srv/other/file.ts');
  });

  it('fails closed on parent-directory segments inside the mapped remote suffix', () => {
    expect(windowsMapping.toHost('/workspace/../secret')).toBe('/workspace/../secret');
  });
});

describe('createPathMapping round trips', () => {
  it('is idempotent across both directions', () => {
    const mapping = createPathMapping({
      platform: 'win32',
      rules: [
        { hostPrefix: 'C:\\projem', remotePrefix: '/workspace', compareKey: 'c:\\projem' },
        { hostPrefix: 'C:\\projem\\deep', remotePrefix: '/deep', compareKey: 'c:\\projem\\deep' },
      ],
    });

    expect(mapping.toHost(mapping.toRemote('C:\\projem\\deep\\src\\a.ts'))).toBe('C:\\projem\\deep\\src\\a.ts');
    expect(mapping.toRemote(mapping.toHost('/deep/src/a.ts'))).toBe('/deep/src/a.ts');
    expect(mapping.toHost(mapping.toRemote('C:\\projem\\src\\a.ts'))).toBe('C:\\projem\\src\\a.ts');
  });

  it('prefers the longest matching prefix', () => {
    const mapping = createPathMapping({
      platform: 'win32',
      rules: [
        { hostPrefix: 'C:\\projem', remotePrefix: '/workspace', compareKey: 'c:\\projem' },
        { hostPrefix: 'C:\\projem\\deep', remotePrefix: '/deep', compareKey: 'c:\\projem\\deep' },
      ],
    });

    expect(mapping.toRemote('C:\\projem\\deep\\a.ts')).toBe('/deep/a.ts');
    expect(mapping.toRemote('C:\\projem\\a.ts')).toBe('/workspace/a.ts');
  });
});

describe('process-wide mapping', () => {
  afterEach(() => {
    setActivePathMapping(null);
  });

  it('defaults to a disabled mapping when OPENCODE_PATH_MAP is unset', () => {
    const mapping = getPathMapping();

    expect(mapping.enabled).toBe(false);
    expect(mapping.toRemote('/anything')).toBe('/anything');
  });

  it('caches the mapping for a stable environment value', () => {
    setActivePathMapping(createPathMapping({
      platform: 'linux',
      rules: [{ hostPrefix: '/home/me/projem', remotePrefix: '/workspace', compareKey: '/home/me/projem' }],
    }));

    expect(getPathMapping().enabled).toBe(true);
    expect(getPathMapping().toRemote('/home/me/projem/src')).toBe('/workspace/src');
  });
});
