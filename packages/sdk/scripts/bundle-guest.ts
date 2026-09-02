import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const usage = 'Usage: bun scripts/bundle-guest.ts <entry.ts> <outfile.js>';

const entry = process.argv[2];
const outfile = process.argv[3];
if (!entry || !outfile) {
  console.error(usage);
  process.exit(1);
}

const bun = globalThis.Bun;
if (!bun?.build) {
  console.error('This bundle command needs Bun.');
  process.exit(1);
}

const result = await bun.build({
  entrypoints: [resolve(entry)],
  format: 'iife',
  target: 'browser',
  minify: true,
  write: false,
});

if (!result.success) {
  const message = result.logs.map((log) => log.message).join('\n');
  console.error(message || 'Guest script build failed');
  process.exit(1);
}

const artifact = result.outputs[0];
if (!artifact) {
  console.error('Guest script build produced no output');
  process.exit(1);
}

await writeFile(resolve(outfile), await artifact.text());
