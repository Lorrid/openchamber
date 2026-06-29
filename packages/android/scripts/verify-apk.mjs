import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const sdkRoot = process.env.ANDROID_HOME || '/Users/jindongtian/Workspace/utils/android-sdk';
const aapt = resolve(sdkRoot, 'build-tools/34.0.0/aapt');
const apk = resolve(root, 'android/app/build/outputs/apk/debug/app-debug.apk');

const fail = (message) => {
  console.error(`[android:verify] ${message}`);
  process.exit(1);
};

if (!existsSync(apk)) fail(`APK not found: ${apk}`);
if (!existsSync(aapt)) fail(`aapt not found: ${aapt}`);

const runAapt = (args) => {
  const result = spawnSync(aapt, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`${aapt} ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
};

const badging = runAapt(['dump', 'badging', apk]);
const manifest = runAapt(['dump', 'xmltree', apk, 'AndroidManifest.xml']);
const assets = runAapt(['list', apk]);

const checks = [
  ['package name', badging.includes("package: name='ai.openchamber.mobile'")],
  ['debug APK is launchable', badging.includes("launchable-activity: name='ai.openchamber.mobile.MainActivity'")],
  ['internet permission', badging.includes("uses-permission: name='android.permission.INTERNET'")],
  ['network state permission', badging.includes("uses-permission: name='android.permission.ACCESS_NETWORK_STATE'")],
  ['cleartext traffic enabled', manifest.includes('android:usesCleartextTraffic') && manifest.includes('0xffffffff')],
  ['network security config packaged', manifest.includes('android:networkSecurityConfig')],
  ['packaged mobile html asset', assets.includes('assets/www/mobile.html')],
  ['packaged Vite assets', assets.includes('assets/www/assets/')],
];

for (const [label, ok] of checks) {
  if (!ok) fail(`Missing expected APK property: ${label}`);
}

console.log('[android:verify] APK checks passed');
