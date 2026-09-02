import type { IssueFilter, IssueTask, IssueTaskField } from './types.ts';

const FIELD_VALUE = (item: IssueTask, field: IssueTaskField): string => {
  if (field === 'status') return item.status ?? '';
  if (field === 'priority') return item.priority ?? '';
  if (field === 'assignee') return item.assignee ?? '';
  return item.team ?? '';
};

export const resolveFilterValue = (filter: Pick<IssueFilter, 'value' | 'allValue'>): string => (
  filter.value || filter.allValue || 'all'
);

const filterIsActive = (filter: IssueFilter): boolean => {
  const allValue = filter.allValue ?? 'all';
  return resolveFilterValue(filter) !== allValue;
};

export const filterIssueTasks = (
  items: readonly IssueTask[],
  query: string,
  filters: readonly IssueFilter[] = [],
): IssueTask[] => {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (needle) {
      const hay = [item.identifier, item.title, item.status, item.priority, item.assignee, item.team, item.badge, item.subtitle]
        .filter((part) => part)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) {
        return false;
      }
    }
    for (const filter of filters) {
      if (!filterIsActive(filter)) {
        continue;
      }
      if (FIELD_VALUE(item, filter.field) !== filter.value) {
        return false;
      }
    }
    return true;
  });
};
