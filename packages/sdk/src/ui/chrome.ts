import { clearNode, ensureStyle } from './dom.ts';
import { filterIssueTasks, resolveFilterValue } from './filter.ts';
import { mountFilterBar } from './filters.ts';
import { mountIssueList } from './list.ts';
import { mountSearchInput } from './search.ts';
import { UI_CSS } from './style.ts';
import type { IssueFilter, IssueViewAction, IssueViewHandle, IssueViewLabels, IssueViewProps, IssueViewToggle } from './types.ts';

const DEFAULT_LABELS: IssueViewLabels = {
  search: 'Search issues',
  empty: 'No open issues found',
  emptyFiltered: 'No issues found',
  busy: 'Loading…',
  open: 'Open',
  more: 'Load more',
};

const resolveLabels = (labels: Partial<IssueViewLabels> | undefined): IssueViewLabels => ({
  search: labels?.search ?? DEFAULT_LABELS.search,
  empty: labels?.empty ?? DEFAULT_LABELS.empty,
  emptyFiltered: labels?.emptyFiltered ?? DEFAULT_LABELS.emptyFiltered,
  busy: labels?.busy ?? DEFAULT_LABELS.busy,
  open: labels?.open ?? DEFAULT_LABELS.open,
  more: labels?.more ?? DEFAULT_LABELS.more,
});

const filtersAreActive = (filters: readonly IssueFilter[], query: string): boolean => {
  if (query.trim() !== '') {
    return true;
  }
  return filters.some((filter) => resolveFilterValue(filter) !== (filter.allValue ?? 'all'));
};

/** Keep chosen values when the guest refreshes definitions or items. */
export const applyFilterValues = (
  definitions: readonly IssueFilter[],
  values: Readonly<Record<string, string>>,
): IssueFilter[] => (
  definitions.map((filter) => ({
    ...filter,
    value: values[filter.id] || filter.value || filter.allValue || 'all',
  }))
);

export const hasIssueToggle = (toggle: IssueViewToggle | undefined): boolean => Boolean(toggle);

export const hasIssueAction = (action: IssueViewAction | undefined): boolean => Boolean(action);

export const hasIssueMore = (props: { hasMore?: boolean; onMore?: () => void }): boolean => (
  Boolean(props.hasMore && props.onMore)
);

const appendToggle = (root: HTMLElement, toggle: IssueViewToggle): void => {
  const label = document.createElement('label');
  label.className = 'oc-sdk-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = toggle.checked;
  input.addEventListener('change', () => {
    toggle.onChange(input.checked);
  });
  const caption = document.createElement('span');
  caption.textContent = toggle.label;
  label.append(input, caption);
  root.append(label);
};

const paintExtras = (
  root: HTMLElement,
  toggle: IssueViewToggle | undefined,
  session: IssueViewToggle | undefined,
  action: IssueViewAction | undefined,
): void => {
  clearNode(root);
  const hasExtras = hasIssueToggle(toggle) || hasIssueToggle(session) || hasIssueAction(action);
  root.hidden = !hasExtras;
  if (toggle) {
    appendToggle(root, toggle);
  }
  if (session) {
    appendToggle(root, session);
  }
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'oc-sdk-more';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      action.onClick();
    });
    root.append(button);
  }
};

type IssueChromeKind = 'picker' | 'page';

export const mountIssueChrome = (
  root: Element,
  initial: IssueViewProps,
  kind: IssueChromeKind,
): IssueViewHandle => {
  ensureStyle(UI_CSS);
  let props = initial;
  let query = '';
  const values: Record<string, string> = {};
  for (const filter of initial.filters ?? []) {
    values[filter.id] = filter.value || filter.allValue || 'all';
  }

  const compactSearch = kind === 'page';
  const shell = document.createElement('div');
  shell.className = 'oc-sdk-stack';
  shell.dataset.ocChrome = kind;
  const header = document.createElement('div');
  header.className = 'oc-sdk-header';
  const searchRoot = document.createElement('div');
  const controls = document.createElement('div');
  controls.className = 'oc-sdk-controls';
  const filterRoot = document.createElement('div');
  filterRoot.className = 'oc-sdk-filters-slot';
  const searchToggleRoot = document.createElement('div');
  searchToggleRoot.className = 'oc-sdk-search-toggle-slot';
  const toggleRoot = document.createElement('div');
  toggleRoot.className = 'oc-sdk-toggle-slot';
  const listRoot = document.createElement('div');
  listRoot.className = 'oc-sdk-slot-list';
  controls.append(filterRoot, searchToggleRoot);
  header.append(searchRoot, controls, toggleRoot);
  shell.append(header, listRoot);
  root.append(shell);
  controls.hidden = (initial.filters ?? []).length === 0 && !compactSearch;

  const liveFilters = (): IssueFilter[] => applyFilterValues(props.filters ?? [], values);

  const paint = (): void => {
    const labels = resolveLabels(props.labels);
    const filters = liveFilters();
    controls.hidden = filters.length === 0 && !compactSearch;
    const items = filterIssueTasks(props.items, query, filters);
    search.update({
      value: query,
      onChange: (next) => {
        query = next;
        paint();
      },
      placeholder: labels.search,
      compact: compactSearch,
    });
    filtersBar.update({
      filters,
      onChange: (id, value) => {
        values[id] = value;
        props.onFilterChange?.(id, value);
        paint();
      },
    });
    list.update({
      items,
      onSelect: (item) => props.onSelect(item),
      onOpen: props.onOpen,
      selectedId: props.selectedId,
      busy: props.busy,
      empty: props.busy ? labels.busy : (filtersAreActive(filters, query) ? labels.emptyFiltered : labels.empty),
      openLabel: labels.open,
      moreLabel: labels.more,
      hasMore: props.hasMore,
      onMore: props.onMore,
    });
    paintExtras(toggleRoot, props.toggle, props.session, props.action);
  };

  const search = mountSearchInput(searchRoot, {
    value: query,
    onChange: (next) => {
      query = next;
      paint();
    },
    placeholder: resolveLabels(props.labels).search,
    compact: compactSearch,
  }, { toggleRoot: searchToggleRoot });

  const filtersBar = mountFilterBar(filterRoot, {
    filters: liveFilters(),
    onChange: (id, value) => {
      values[id] = value;
      props.onFilterChange?.(id, value);
      paint();
    },
  });

  const list = mountIssueList(listRoot, {
    items: filterIssueTasks(props.items, query, liveFilters()),
    onSelect: (item) => props.onSelect(item),
    onOpen: props.onOpen,
    selectedId: props.selectedId,
    busy: props.busy,
    empty: props.busy ? resolveLabels(props.labels).busy : resolveLabels(props.labels).empty,
    openLabel: resolveLabels(props.labels).open,
    moreLabel: resolveLabels(props.labels).more,
    hasMore: initial.hasMore,
    onMore: initial.onMore,
  });
  paintExtras(toggleRoot, initial.toggle, initial.session, initial.action);

  return {
    update: (next) => {
      props = next;
      paint();
    },
    dispose: () => {
      search.dispose();
      filtersBar.dispose();
      list.dispose();
      shell.remove();
    },
  };
};
