import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../..');
const webDist = resolve(repoRoot, 'packages/web/dist');
const mobileHtml = resolve(webDist, 'mobile.html');
const assetsDir = resolve(packageRoot, 'android/app/src/main/assets/www');

const fail = (message) => {
  console.error(`[android:assets] ${message}`);
  process.exit(1);
};

if (!existsSync(mobileHtml)) {
  fail(`Missing ${mobileHtml}. Run bun run build:web before packaging Android.`);
}

rmSync(assetsDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });
cpSync(webDist, assetsDir, { recursive: true });

console.log(`[android:assets] Copied ${webDist} -> ${assetsDir}`);
