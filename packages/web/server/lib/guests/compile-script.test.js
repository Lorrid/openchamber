import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileGuestScript } from './compile-script.js';

const helloMainJs = path.resolve(
  fileURLToPath(new URL('../../../../../examples/hello-panel/panel/main.js', import.meta.url)),
);

describe('compileGuestScript', () => {
  test('bundles the hello panel from connectHost', async () => {
    const body = await compileGuestScript(helloMainJs);
    expect(body).toBeTruthy();
    const text = body?.toString('utf8') ?? '';
    expect(text).toContain('openchamber.sdk');
    expect(text).toContain('HELLO-1');
  });
});
