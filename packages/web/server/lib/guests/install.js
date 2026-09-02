import path from 'node:path';
import { z } from 'zod';

import {
  inspectGuestPackage,
  listInstalledGuests,
  resolveGuestPackageRoot,
  toPublicGuest,
} from './catalog.js';
import { readExtensionPaths, writeExtensionPaths } from './persist.js';

const installBodySchema = z.object({
  path: z.string().trim().min(1),
});

export const parseInstallRequest = (body) => {
  const parsed = installBodySchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

export const installGuestFromPath = async (rawPath, persistPath) => {
  if (!path.isAbsolute(rawPath)) {
    return { ok: false, code: 'invalid-path' };
  }
  const root = await resolveGuestPackageRoot(rawPath);
  if (!root) {
    return { ok: false, code: 'not-found' };
  }

  const inspected = await inspectGuestPackage(root);
  if (!inspected.ok) {
    return inspected;
  }
  const guest = inspected.guest;

  const stored = await readExtensionPaths(persistPath);
  const storedRoots = await Promise.all(stored.map((entry) => resolveGuestPackageRoot(entry)));
  if (storedRoots.some((entry) => entry === root)) {
    return { ok: false, code: 'already-installed' };
  }

  const existing = await listInstalledGuests({ persistPath });
  if (existing.some((entry) => entry.id === guest.id)) {
    return { ok: false, code: 'id-taken' };
  }

  await writeExtensionPaths([...stored, root], persistPath);
  return {
    ok: true,
    guest: toPublicGuest({ ...guest, source: 'path', path: root }),
  };
};

export const uninstallGuest = async (id, persistPath) => {
  const existing = await listInstalledGuests({ persistPath });
  const guest = existing.find((entry) => entry.id === id);
  if (!guest) {
    return { ok: false, code: 'not-found' };
  }
  if (guest.source === 'bundled') {
    return { ok: false, code: 'bundled' };
  }

  const stored = await readExtensionPaths(persistPath);
  const kept = [];
  for (const entry of stored) {
    const root = await resolveGuestPackageRoot(entry);
    if (root === guest.packageRoot) {
      continue;
    }
    kept.push(entry);
  }
  await writeExtensionPaths(kept, persistPath);
  return { ok: true };
};
