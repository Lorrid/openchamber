import { runtimeFetch } from '@/lib/runtime-fetch';
import { z } from 'zod';

import { parseInstalledGuestJson } from './parse.ts';
import type { InstalledGuest } from './types.ts';

const errorSchema = z.object({
  error: z.enum([
    'invalid-path',
    'not-found',
    'invalid-manifest',
    'id-taken',
    'already-installed',
    'missing-build',
    'bundled',
  ]),
});

export type InstallGuestErrorCode =
  | 'invalid-path'
  | 'not-found'
  | 'invalid-manifest'
  | 'id-taken'
  | 'already-installed'
  | 'missing-build'
  | 'bundled'
  | 'failed';

type InstallGuestResult =
  | { ok: true; guest: InstalledGuest }
  | { ok: false; code: InstallGuestErrorCode };

type UninstallGuestResult =
  | { ok: true }
  | { ok: false; code: InstallGuestErrorCode };

const readErrorCode = async (response: Response): Promise<InstallGuestErrorCode> => {
  try {
    const parsed = errorSchema.safeParse(JSON.parse(await response.text()));
    return parsed.success ? parsed.data.error : 'failed';
  } catch {
    return 'failed';
  }
};

export const installGuestPath = async (folderPath: string): Promise<InstallGuestResult> => {
  try {
    const response = await runtimeFetch('/api/guests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ path: folderPath }),
    });
    if (!response.ok) {
      return { ok: false, code: await readErrorCode(response) };
    }
    const guest = parseInstalledGuestJson(await response.text());
    if (!guest) {
      return { ok: false, code: 'failed' };
    }
    return { ok: true, guest };
  } catch {
    return { ok: false, code: 'failed' };
  }
};

export const uninstallGuest = async (id: string): Promise<UninstallGuestResult> => {
  try {
    const response = await runtimeFetch(`/api/guests/${id}`, { method: 'DELETE' });
    if (response.status === 204) {
      return { ok: true };
    }
    return { ok: false, code: await readErrorCode(response) };
  } catch {
    return { ok: false, code: 'failed' };
  }
};
