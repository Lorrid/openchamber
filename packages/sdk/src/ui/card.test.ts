import { describe, expect, test } from 'bun:test';

import { resolveIssueCardLabels } from './card.ts';

describe('resolveIssueCardLabels', () => {
  test('fills Linear-style defaults', () => {
    expect(resolveIssueCardLabels({}).back).toBe('Back');
    expect(resolveIssueCardLabels({}).action).toBe('Start session');
    expect(resolveIssueCardLabels({ action: 'Attach' }).action).toBe('Attach');
  });
});
