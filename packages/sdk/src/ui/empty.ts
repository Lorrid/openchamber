import { clearNode, ensureStyle } from './dom.ts';
import { UI_CSS } from './style.ts';
import { mountButton, type ButtonHandle } from './button.ts';

export type EmptyProps = {
  title: string;
  body?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
};

export type EmptyHandle = {
  update: (next: Partial<EmptyProps>) => void;
  dispose: () => void;
};

export const mountEmpty = (root: Element, initial: EmptyProps): EmptyHandle => {
  ensureStyle(UI_CSS);
  let props = initial;
  const shell = document.createElement('div');
  shell.className = 'oc-sdk-empty-state';
  root.append(shell);
  let action: ButtonHandle | null = null;

  const paint = (): void => {
    action?.dispose();
    action = null;
    clearNode(shell);
    const title = document.createElement('h2');
    title.className = 'oc-sdk-empty-title';
    title.textContent = props.title;
    shell.append(title);
    if (props.body) {
      const body = document.createElement('p');
      body.className = 'oc-sdk-empty-body';
      body.textContent = props.body;
      shell.append(body);
    }
    if (props.action) {
      const slot = document.createElement('div');
      slot.className = 'oc-sdk-empty-action';
      action = mountButton(slot, {
        label: props.action.label,
        onClick: props.action.onClick,
      });
      shell.append(slot);
    }
  };

  paint();

  return {
    update: (next) => {
      props = { ...props, ...next };
      paint();
    },
    dispose: () => {
      action?.dispose();
      action = null;
      clearNode(shell);
      shell.remove();
    },
  };
};
