import { clearNode, ensureStyle } from './dom.ts';
import { icon } from './icons.ts';
import { UI_CSS } from './style.ts';
import type { IssueListHandle, IssueListProps, IssueTask } from './types.ts';

type IssueRowParts = {
  id: string;
  title: string;
  badge: string;
  subtitle: string;
};

export const issueRowParts = (item: IssueTask): IssueRowParts => ({
  id: item.identifier ?? item.id,
  title: item.title,
  badge: item.badge?.trim() ?? '',
  subtitle: item.subtitle?.trim() ?? '',
});

export const mountIssueList = (root: Element, initial: IssueListProps): IssueListHandle => {
  ensureStyle(UI_CSS);
  let props = initial;
  let more: HTMLButtonElement | null = null;

  const wrap = document.createElement('div');
  wrap.className = 'oc-sdk-list-wrap';
  const list = document.createElement('div');
  list.className = 'oc-sdk-list';
  list.setAttribute('role', 'listbox');
  wrap.append(list);
  root.append(wrap);

  const paint = (): void => {
    clearNode(list);
    more?.remove();
    more = null;
    if (props.busy && props.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'oc-sdk-empty';
      empty.textContent = props.empty ?? 'Loading…';
      list.append(empty);
      return;
    }
    if (props.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'oc-sdk-empty';
      empty.textContent = props.empty ?? 'No open issues found';
      list.append(empty);
      return;
    }
    for (const item of props.items) {
      const row = document.createElement('div');
      row.className = 'oc-sdk-row';
      row.setAttribute('role', 'option');
      row.tabIndex = 0;
      row.dataset.id = item.id;
      if (props.selectedId === item.id) {
        row.dataset.selected = 'true';
      }
      const parts = issueRowParts(item);
      const id = document.createElement('span');
      id.className = 'oc-sdk-id';
      id.textContent = parts.id;
      const title = document.createElement('span');
      title.className = 'oc-sdk-title';
      title.textContent = parts.title;
      row.append(id, title);
      if (parts.badge) {
        const badge = document.createElement('span');
        badge.className = 'oc-sdk-badge';
        badge.textContent = parts.badge;
        row.append(badge);
      }
      if (parts.subtitle) {
        const subtitle = document.createElement('span');
        subtitle.className = 'oc-sdk-subtitle';
        subtitle.textContent = parts.subtitle;
        row.append(subtitle);
      }
      if (item.url && props.onOpen) {
        const openSlot = document.createElement('div');
        openSlot.className = 'oc-sdk-open-slot';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'oc-sdk-open';
        open.setAttribute('aria-label', props.openLabel ?? 'Open');
        open.append(icon('open', 16));
        open.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onOpen?.(item);
        });
        openSlot.append(open);
        row.append(openSlot);
      }
      row.addEventListener('click', () => {
        props.onSelect(item);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          props.onSelect(item);
        }
      });
      list.append(row);
    }
    if (props.hasMore && props.onMore) {
      more = document.createElement('button');
      more.type = 'button';
      more.className = 'oc-sdk-more';
      more.textContent = props.moreLabel ?? 'Load more';
      more.addEventListener('click', () => {
        props.onMore?.();
      });
      wrap.append(more);
    }
  };

  paint();

  return {
    update: (next) => {
      props = next;
      paint();
    },
    dispose: () => {
      wrap.remove();
    },
  };
};
