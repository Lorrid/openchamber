import { runtimeFetch } from '@/lib/runtime-fetch';
import { z } from 'zod';

import { parseInstalledGuestJson } from './parse.ts';
import type { InstalledGuest } from './types.ts';

const errorSchema = z.object({
  error: z.enum([
    'invalid-path',
    'invalid-url',
    'not-found',
    'invalid-manifest',
    'id-taken',
    'already-installed',
    'missing-build',
    'bundled',
    'clone-failed',
    'extract-failed',
  ]),
});

export type InstallGuestErrorCode =
  | 'invalid-path'
  | 'invalid-url'
  | 'not-found'
  | 'invalid-manifest'
  | 'id-taken'
  | 'already-installed'
  | 'missing-build'
  | 'bundled'
  | 'clone-failed'
  | 'extract-failed'
  | 'failed';

type InstallGuestResult =
  | { ok: true; guest: InstalledGuest }
  | { ok: false; code: InstallGuestErrorCode };

type UninstallGuestResult =
  | { ok: true }
  | { ok: false; code: InstallGuestErrorCode };

type InstallGuestRequest = { path: string } | { url: string };

type ParseInstallInputResult =
  | { ok: true; request: InstallGuestRequest }
  | { ok: false; code: 'invalid-path' | 'invalid-url' };

export const parseInstallInput = (raw: string): ParseInstallInputResult => {
  const value = raw.trim();
  if (!value) {
    return { ok: false, code: 'invalid-path' };
  }
  if (value.slice(0, 8).toLowerCase() === 'https://') {
    return { ok: true, request: { url: value } };
  }
  const windowsPath = /^[a-zA-Z]:[\\/]/.test(value);
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !windowsPath) {
    return { ok: false, code: 'invalid-url' };
  }
  if (value.startsWith('/') || windowsPath || value.startsWith('\\\\')) {
    return { ok: true, request: { path: value } };
  }
  return { ok: false, code: 'invalid-path' };
};

const readErrorCode = async (response: Response): Promise<InstallGuestErrorCode> => {
  try {
    const parsed = errorSchema.safeParse(JSON.parse(await response.text()));
    return parsed.success ? parsed.data.error : 'failed';
  } catch {
    return 'failed';
  }
};

export const installGuest = async (input: string): Promise<InstallGuestResult> => {
  const parsed = parseInstallInput(input);
  if (!parsed.ok) {
    return parsed;
  }
  try {
    const response = await runtimeFetch('/api/guests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(parsed.request),
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
