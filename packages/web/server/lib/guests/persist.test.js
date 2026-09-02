import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { extensionsPersistPath, readExtensionPaths, writeExtensionPaths } from './persist.js';

describe('extensionsPersistPath', () => {
  test('joins the instance data dir and refuses a relative path', () => {
    const dataDir = path.join(os.tmpdir(), 'oc-instance-a');
    expect(extensionsPersistPath(dataDir)).toBe(path.join(dataDir, 'extensions.json'));
    expect(() => extensionsPersistPath('relative')).toThrow('absolute OpenChamber data dir');
    expect(() => extensionsPersistPath('')).toThrow('absolute OpenChamber data dir');
  });
});

describe('extension persist', () => {
  test('round-trips paths and treats a missing file as empty', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-ext-'));
    const file = extensionsPersistPath(dir);
    expect(await readExtensionPaths(file)).toEqual([]);
    await writeExtensionPaths(['/one', '/two'], file);
    expect(await readExtensionPaths(file)).toEqual(['/one', '/two']);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('keeps two instance stores apart', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-ext-'));
    const a = extensionsPersistPath(path.join(parent, 'a'));
    const b = extensionsPersistPath(path.join(parent, 'b'));
    await writeExtensionPaths(['/one'], a);
    await writeExtensionPaths(['/two'], b);
    expect(await readExtensionPaths(a)).toEqual(['/one']);
    expect(await readExtensionPaths(b)).toEqual(['/two']);
    await fs.rm(parent, { recursive: true, force: true });
  });

  test('refuses a corrupt store', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-ext-'));
    const file = extensionsPersistPath(dir);
    await fs.writeFile(file, '{"paths":[1]}', 'utf8');
    try {
      await readExtensionPaths(file);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('Invalid extensions store');
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
});
