import { clearNode, ensureStyle } from './dom.ts';
import { icon } from './icons.ts';
import { createChoiceMenu, placeFixedMenu } from './menu.ts';
import { UI_CSS } from './style.ts';
import { resolveFilterValue } from './filter.ts';
import type { FilterBarHandle, FilterBarProps, IssueFilter, IssueFilterSlot } from './types.ts';

const isFilterActive = (filter: IssueFilter): boolean => (
  resolveFilterValue(filter) !== (filter.allValue ?? 'all')
);

const selectedFilterLabel = (filter: IssueFilter): string => {
  const selected = filter.options.find((option) => option.id === resolveFilterValue(filter));
  return selected?.label ?? filter.label;
};

/** First filter is `start` unless the guest set `slot`. */
export const resolveFilterSlot = (filter: IssueFilter, index: number): IssueFilterSlot => (
  filter.slot === 'start' || filter.slot === 'end'
    ? filter.slot
    : (index === 0 ? 'start' : 'end')
);

export const mountFilterBar = (root: Element, initial: FilterBarProps): FilterBarHandle => {
  ensureStyle(UI_CSS);
  let props = initial;
  let openFilterId: string | null = null;
  let menu: HTMLDivElement | null = null;
  let openTrigger: HTMLButtonElement | null = null;

  const bar = document.createElement('div');
  bar.className = 'oc-sdk-filters';
  root.append(bar);

  const removeMenu = (): void => {
    menu?.remove();
    menu = null;
    openTrigger = null;
  };

  const placeMenu = (): void => {
    if (!menu || !openTrigger) {
      return;
    }
    placeFixedMenu(menu, openTrigger);
  };

  const paint = (): void => {
    removeMenu();
    clearNode(bar);
    bar.hidden = props.filters.length === 0;
    const startGroup = document.createElement('div');
    startGroup.className = 'oc-sdk-filter-group';
    startGroup.dataset.slot = 'start';
    const endGroup = document.createElement('div');
    endGroup.className = 'oc-sdk-filter-group';
    endGroup.dataset.slot = 'end';
    props.filters.forEach((filter, index) => {
      const slot = resolveFilterSlot(filter, index);
      const wrap = document.createElement('div');
      wrap.className = 'oc-sdk-filter';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'oc-sdk-filter-trigger';
      trigger.setAttribute('aria-label', filter.label);
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', openFilterId === filter.id ? 'true' : 'false');
      trigger.dataset.active = isFilterActive(filter) ? 'true' : 'false';
      const value = document.createElement('span');
      value.className = 'oc-sdk-filter-value';
      value.textContent = selectedFilterLabel(filter);
      trigger.append(
        icon(filter.field, 14, 'oc-sdk-filter-icon'),
        value,
        icon('chevron', 16, 'oc-sdk-filter-chevron'),
      );
      trigger.addEventListener('click', () => {
        openFilterId = openFilterId === filter.id ? null : filter.id;
        paint();
      });
      wrap.append(trigger);
      (slot === 'start' ? startGroup : endGroup).append(wrap);
      if (openFilterId === filter.id) {
        openTrigger = trigger;
        menu = createChoiceMenu(filter.label, filter.value, filter.options, (id) => {
          openFilterId = null;
          props.onChange(filter.id, id);
        });
        document.body.append(menu);
      }
    });
    if (startGroup.childElementCount > 0) {
      bar.append(startGroup);
    }
    if (endGroup.childElementCount > 0) {
      bar.append(endGroup);
    }
    placeMenu();
  };

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (!(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest('.oc-sdk-filter') || event.target.closest('.oc-sdk-menu')) {
      return;
    }
    if (!openFilterId) {
      return;
    }
    openFilterId = null;
    paint();
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !openFilterId) {
      return;
    }
    openFilterId = null;
    paint();
  };

  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeyDown);
  window.addEventListener('resize', placeMenu);
  window.addEventListener('scroll', placeMenu, true);
  paint();

  return {
    update: (next) => {
      props = next;
      paint();
    },
    dispose: () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
      removeMenu();
      bar.remove();
    },
  };
};
