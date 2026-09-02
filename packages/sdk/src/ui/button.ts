import { clearNode, ensureStyle } from './dom.ts';
import { UI_CSS } from './style.ts';

export type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'destructive';

export type ButtonProps = {
  label: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick: () => void;
};

export type ButtonHandle = {
  update: (next: Partial<ButtonProps>) => void;
  dispose: () => void;
};

export const resolveButtonVariant = (variant: ButtonVariant | undefined): ButtonVariant => (
  variant ?? 'default'
);

export const mountButton = (root: Element, initial: ButtonProps): ButtonHandle => {
  ensureStyle(UI_CSS);
  let props = initial;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'oc-sdk-btn';
  root.append(button);

  const paint = (): void => {
    button.dataset.variant = resolveButtonVariant(props.variant);
    button.disabled = Boolean(props.disabled);
    button.textContent = props.label;
  };

  button.addEventListener('click', () => {
    if (props.disabled) {
      return;
    }
    props.onClick();
  });

  paint();

  return {
    update: (next) => {
      props = { ...props, ...next };
      paint();
    },
    dispose: () => {
      clearNode(button);
      button.remove();
    },
  };
};
