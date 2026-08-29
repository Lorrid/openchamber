import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_NOTIFICATION_INBOX_FILTER,
  parseNotificationInboxFilter,
} from './notificationInboxFilter';

describe('parseNotificationInboxFilter', () => {
  test('returns null for missing or malformed values', () => {
    expect(parseNotificationInboxFilter(null)).toBeNull();
    expect(parseNotificationInboxFilter('all')).toBeNull();
    expect(parseNotificationInboxFilter({})).toBeNull();
  });

  test('defaults hide subtasks', () => {
    expect(DEFAULT_NOTIFICATION_INBOX_FILTER.sessionSubtask).toBe(false);
  });

  test('fills defaults around known booleans', () => {
    expect(parseNotificationInboxFilter({ success: true })).toEqual({
      ...DEFAULT_NOTIFICATION_INBOX_FILTER,
      success: true,
    });
    expect(parseNotificationInboxFilter({ sessionSubtask: true })).toEqual({
      ...DEFAULT_NOTIFICATION_INBOX_FILTER,
      sessionSubtask: true,
    });
    expect(parseNotificationInboxFilter({ info: true, sessionFinished: false })).toEqual({
      ...DEFAULT_NOTIFICATION_INBOX_FILTER,
      sessionFinished: false,
      info: true,
    });
  });
});
