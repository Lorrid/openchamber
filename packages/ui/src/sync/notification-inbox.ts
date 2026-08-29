import { useMemo } from 'react';
import { isInboxKindEnabled, type NotificationInboxFilter } from '@/lib/notificationInboxFilter';
import { useUIStore } from '@/stores/useUIStore';
import { inboxKindOf, type NotificationRecord } from './notification-record';
import { useNotificationStore } from './notification-store';

const notificationMatchesInboxFilter = (
  notification: NotificationRecord,
  filter: NotificationInboxFilter,
): boolean => isInboxKindEnabled(filter, inboxKindOf(notification));

export const selectInboxNotifications = (
  list: NotificationRecord[],
  filter: NotificationInboxFilter,
): NotificationRecord[] => {
  const visible = list.filter((notification) => notificationMatchesInboxFilter(notification, filter));
  return [...visible].sort((left, right) => {
    if (left.read !== right.read) return left.read ? 1 : -1;
    return right.time - left.time;
  });
};

export const stabilizeInboxOrder = (
  previousIds: readonly string[],
  items: NotificationRecord[],
): NotificationRecord[] => {
  const byId = new Map(items.map((item) => [item.id, item]));
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const id of previousIds) {
    if (!byId.has(id)) continue;
    kept.push(id);
    seen.add(id);
  }
  const ids = items.filter((item) => !seen.has(item.id)).map((item) => item.id).concat(kept);
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
};

export const countInboxUnread = (
  list: NotificationRecord[],
  filter: NotificationInboxFilter,
): number => list.reduce((count, notification) => {
  if (notification.read) return count;
  if (!notificationMatchesInboxFilter(notification, filter)) return count;
  return count + 1;
}, 0);

const useNotificationInboxFilter = (): NotificationInboxFilter => (
  useUIStore((state) => state.notificationInboxFilter)
);

export const useInboxNotifications = (): NotificationRecord[] => {
  const list = useNotificationStore((state) => state.list);
  const filter = useNotificationInboxFilter();
  return useMemo(() => selectInboxNotifications(list, filter), [filter, list]);
};

export const useInboxUnreadCount = (): number => {
  const list = useNotificationStore((state) => state.list);
  const filter = useNotificationInboxFilter();
  return useMemo(() => countInboxUnread(list, filter), [filter, list]);
};
