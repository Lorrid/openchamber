import { icon } from './icons.ts';
import type { IssueFilterOption } from './types.ts';

export const placeFixedMenu = (menu: HTMLElement, trigger: HTMLElement): void => {
  const rect = trigger.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  const overflow = menu.getBoundingClientRect().right - window.innerWidth + 8;
  if (overflow > 0) {
    menu.style.left = `${Math.max(8, rect.left - overflow)}px`;
  }
};

export const createChoiceMenu = (
  label: string,
  value: string,
  options: readonly IssueFilterOption[],
  onPick: (id: string) => void,
): HTMLDivElement => {
  const menu = document.createElement('div');
  menu.className = 'oc-sdk-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', label);
  for (const option of options) {
    const selected = option.id === value;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'oc-sdk-menu-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', selected ? 'true' : 'false');
    const caption = document.createElement('span');
    caption.className = 'oc-sdk-menu-label';
    caption.textContent = option.label;
    const mark = document.createElement('span');
    mark.className = 'oc-sdk-menu-check';
    if (selected) {
      mark.append(icon('check', 12));
    }
    item.append(caption, mark);
    item.addEventListener('click', () => {
      onPick(option.id);
    });
    menu.append(item);
  }
  return menu;
};
