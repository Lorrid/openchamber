import { ensureStyle } from './dom.ts';
import { icon } from './icons.ts';
import { UI_CSS } from './style.ts';
import type { SearchInputHandle, SearchInputProps } from './types.ts';

const paint = (search: HTMLInputElement, props: SearchInputProps): void => {
  const placeholder = props.placeholder ?? 'Search issues';
  search.placeholder = placeholder;
  search.setAttribute('aria-label', props.label ?? placeholder);
  if (search.value !== props.value) {
    search.value = props.value;
  }
};

export const mountSearchInput = (
  root: Element,
  initial: SearchInputProps,
  slots?: { toggleRoot?: Element },
): SearchInputHandle => {
  ensureStyle(UI_CSS);
  let props = initial;
  let open = !initial.compact;

  const wrap = document.createElement('div');
  wrap.className = 'oc-sdk-search-wrap';
  const field = document.createElement('div');
  field.className = 'oc-sdk-search-field';
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'oc-sdk-search';
  search.spellcheck = false;
  search.autocomplete = 'off';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'oc-sdk-search-toggle';
  toggle.append(icon('search', 14, 'oc-sdk-filter-icon'));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'oc-sdk-search-close';
  close.append(icon('close', 14));
  field.append(icon('search', 16, 'oc-sdk-search-icon'), search, close);
  wrap.append(field);
  root.append(wrap);
  (slots?.toggleRoot ?? wrap).append(toggle);

  const syncOpen = (): void => {
    wrap.dataset.compact = props.compact ? 'true' : 'false';
    wrap.dataset.open = open ? 'true' : 'false';
    wrap.dataset.active = props.value.trim() !== '' ? 'true' : 'false';
    const label = props.label ?? props.placeholder ?? 'Search issues';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    close.setAttribute('aria-label', 'Close search');
    close.title = 'Close search';
  };

  const closeCompact = (): void => {
    if (!props.compact) {
      return;
    }
    open = false;
    if (props.value !== '') {
      props.onChange('');
    }
    syncOpen();
  };

  const onInput = (): void => {
    props.onChange(search.value);
  };
  const onToggle = (): void => {
    open = true;
    syncOpen();
    search.focus();
  };
  const onClose = (): void => {
    closeCompact();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && props.compact && open) {
      event.preventDefault();
      closeCompact();
    }
  };

  search.addEventListener('input', onInput);
  search.addEventListener('keydown', onKeyDown);
  toggle.addEventListener('click', onToggle);
  close.addEventListener('click', onClose);
  paint(search, props);
  syncOpen();

  return {
    update: (next) => {
      props = next;
      if (!props.compact) {
        open = true;
      }
      paint(search, props);
      syncOpen();
    },
    dispose: () => {
      search.removeEventListener('input', onInput);
      search.removeEventListener('keydown', onKeyDown);
      toggle.removeEventListener('click', onToggle);
      close.removeEventListener('click', onClose);
      toggle.remove();
      wrap.remove();
    },
  };
};
