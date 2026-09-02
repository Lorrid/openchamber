import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const storeSchema = z.object({
  paths: z.array(z.string().min(1).refine((entry) => !entry.includes('\0'))),
});

const parseStore = (raw) => {
  try {
    const parsed = storeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const dataDirSchema = z.string().min(1).refine((entry) => !entry.includes('\0') && path.isAbsolute(entry));

/** `{openchamberDataDir}/extensions.json`. One catalog per OpenChamber instance. */
export const extensionsPersistPath = (dataDir) => {
  const parsed = dataDirSchema.safeParse(dataDir);
  if (!parsed.success) {
    throw new Error('Guest persist needs an absolute OpenChamber data dir');
  }
  return path.join(parsed.data, 'extensions.json');
};

export const readExtensionPaths = async (persistPath) => {
  try {
    const raw = await fs.readFile(persistPath, 'utf8');
    const parsed = parseStore(raw);
    if (!parsed) {
      throw new Error('Invalid extensions store');
    }
    return parsed.paths;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

export const writeExtensionPaths = async (paths, persistPath) => {
  await fs.mkdir(path.dirname(persistPath), { recursive: true });
  const tmp = `${persistPath}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify({ paths }, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, persistPath);
};
