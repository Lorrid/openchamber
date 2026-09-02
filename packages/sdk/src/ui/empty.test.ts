import { describe, expect, test } from 'bun:test';

describe('mountEmpty', () => {
  test('exports a mount that guests can call without host React', async () => {
    const { mountEmpty } = await import('./empty.ts');
    expect(typeof mountEmpty).toBe('function');
  });
});
