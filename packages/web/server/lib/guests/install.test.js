import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { listInstalledGuests } from './catalog.js';
import { installGuestFromPath, parseInstallRequest, uninstallGuest } from './install.js';

const writeGuest = async (root, id) => {
  await fs.mkdir(path.join(root, 'panel'), { recursive: true });
  await fs.writeFile(path.join(root, 'panel', 'index.html'), '<html></html>');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: `@openchamber/${id}`,
    openchamber: {
      apiVersion: 1,
      contributes: {
        panel: { id, name: id, icon: 'window', entry: 'panel/index.html' },
      },
    },
  }));
};

describe('installGuestFromPath', () => {
  test('installs a folder extension and refuses a second copy', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-ext-'));
    const persistPath = path.join(dir, 'extensions.json');
    const guestRoot = path.join(dir, 'clone');
    await writeGuest(guestRoot, 'clone-hello');

    expect(parseInstallRequest({ path: guestRoot })).toEqual({ path: guestRoot });
    expect(parseInstallRequest({})).toBeNull();

    const installed = await installGuestFromPath(guestRoot, persistPath);
    expect(installed.ok).toBe(true);
    if (!installed.ok) {
      throw new Error('expected install');
    }
    expect(installed.guest.id).toBe('clone-hello');
    expect(installed.guest.source).toBe('path');

    const listed = await listInstalledGuests({ persistPath });
    expect(listed.some((guest) => guest.id === 'clone-hello')).toBe(true);

    const again = await installGuestFromPath(guestRoot, persistPath);
    expect(again).toEqual({ ok: false, code: 'already-installed' });

    const otherRoot = path.join(dir, 'other');
    await writeGuest(otherRoot, 'clone-hello');
    const taken = await installGuestFromPath(otherRoot, persistPath);
    expect(taken).toEqual({ ok: false, code: 'id-taken' });

    const relative = await installGuestFromPath('clone', persistPath);
    expect(relative).toEqual({ ok: false, code: 'invalid-path' });

    const badIdRoot = path.join(dir, 'bad-id');
    await writeGuest(badIdRoot, 'Not Kebab');
    const badId = await installGuestFromPath(badIdRoot, persistPath);
    expect(badId).toEqual({ ok: false, code: 'invalid-manifest' });

    const removed = await uninstallGuest('clone-hello', persistPath);
    expect(removed).toEqual({ ok: true });
    const after = await listInstalledGuests({ persistPath });
    expect(after.some((guest) => guest.id === 'clone-hello')).toBe(false);

    const missing = await uninstallGuest('hello', persistPath);
    expect(missing).toEqual({ ok: false, code: 'not-found' });

    await fs.rm(dir, { recursive: true, force: true });
  });

  test('refuses a panel that has TypeScript but no built script', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-ext-'));
    const persistPath = path.join(dir, 'extensions.json');
    const guestRoot = path.join(dir, 'source-only');
    await fs.mkdir(path.join(guestRoot, 'panel'), { recursive: true });
    await fs.writeFile(path.join(guestRoot, 'panel', 'index.html'), '<script src="./main.js"></script>');
    await fs.writeFile(path.join(guestRoot, 'panel', 'main.ts'), 'console.log(1)');
    await fs.writeFile(path.join(guestRoot, 'package.json'), JSON.stringify({
      name: '@openchamber/source-only',
      openchamber: {
        apiVersion: 1,
        contributes: {
          panel: { id: 'source-only', name: 'Source', icon: 'window', entry: 'panel/index.html' },
        },
      },
    }));

    const result = await installGuestFromPath(guestRoot, persistPath);
    expect(result).toEqual({ ok: false, code: 'missing-build' });

    await fs.rm(dir, { recursive: true, force: true });
  });

  test('keeps two instance catalogs apart', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-ext-'));
    const persistA = path.join(parent, 'a', 'extensions.json');
    const persistB = path.join(parent, 'b', 'extensions.json');
    const guestRoot = path.join(parent, 'clone');
    await writeGuest(guestRoot, 'clone-hello');

    const installed = await installGuestFromPath(guestRoot, persistA);
    expect(installed.ok).toBe(true);
    expect(await listInstalledGuests({ persistPath: persistB })).toEqual([]);
    expect((await listInstalledGuests({ persistPath: persistA })).some((guest) => guest.id === 'clone-hello')).toBe(true);

    await fs.rm(parent, { recursive: true, force: true });
  });
});
