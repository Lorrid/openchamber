import { afterEach, describe, expect, it } from 'vitest';

import { createPathMapping, getPathMapping, setActiveInstancePathMapping } from './path-mapping.js';

afterEach(() => {
  setActiveInstancePathMapping(null);
});

describe('instance-aware path mapping resolution', () => {
  it('keeps the env/identity contract when no Docker instance is active', () => {
    delete process.env.OPENCODE_PATH_MAP;
    expect(getPathMapping().enabled).toBe(false);
    expect(getPathMapping().toRemote('C:\\proj\\foo\\x')).toBe('C:\\proj\\foo\\x');
  });

  it('env mapping keeps working unchanged when no instance mapping is installed', () => {
    process.env.OPENCODE_PATH_MAP = 'C:\\proj\\foo=/workspace';
    try {
      const mapping = getPathMapping();
      expect(mapping.toRemote('C:\\proj\\foo\\src')).toBe('/workspace/src');
      expect(mapping.toHost('/workspace/src')).toBe('C:\\proj\\foo\\src');
    } finally {
      delete process.env.OPENCODE_PATH_MAP;
    }
  });

  it('the active instance mapping takes precedence over the env mapping', () => {
    process.env.OPENCODE_PATH_MAP = 'C:\\legacy=/srv/legacy';
    try {
      setActiveInstancePathMapping(createPathMapping({
        rules: [{ hostPrefix: 'C:\\proj\\foo', remotePrefix: '/workspace' }],
      }));
      const mapping = getPathMapping();
      expect(mapping.toRemote('C:\\proj\\foo\\src')).toBe('/workspace/src');
      expect(mapping.toHost('/workspace/README.md')).toBe('C:\\proj\\foo\\README.md');
      // Env prefixes remain reachable through fallback semantics of the
      // instance mapping (unmapped values pass through to the caller as-is).
      expect(mapping.toRemote('C:\\other\\x')).toBe('C:\\other\\x');
    } finally {
      delete process.env.OPENCODE_PATH_MAP;
    }
  });

  it('deactivating the instance mapping restores the env mapping', () => {
    process.env.OPENCODE_PATH_MAP = 'C:\\proj\\foo=/workspace';
    try {
      setActiveInstancePathMapping(createPathMapping({
        rules: [{ hostPrefix: 'C:\\other', remotePrefix: '/other' }],
      }));
      setActiveInstancePathMapping(null);
      expect(getPathMapping().toRemote('C:\\proj\\foo\\src')).toBe('/workspace/src');
    } finally {
      delete process.env.OPENCODE_PATH_MAP;
      setActiveInstancePathMapping(null);
    }
  });

  it('parent-directory hints still fail closed through the instance mapping', () => {
    setActiveInstancePathMapping(createPathMapping({
      rules: [{ hostPrefix: 'C:\\proj\\foo', remotePrefix: '/workspace' }],
    }));
    const mapping = getPathMapping();
    expect(mapping.toRemote('C:\\proj\\foo\\..\\secret')).toBe('C:\\proj\\foo\\..\\secret');
    expect(mapping.toHost('/workspace/../secret')).toBe('/workspace/../secret');
  });
});
