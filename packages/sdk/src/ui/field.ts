import { clearNode, ensureStyle } from './dom.ts';
import { UI_CSS } from './style.ts';

export type TextFieldProps = {
  label: string;
  value: string;
  password?: boolean;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export type TextFieldHandle = {
  update: (next: Partial<TextFieldProps>) => void;
  dispose: () => void;
};

export const mountTextField = (root: Element, initial: TextFieldProps): TextFieldHandle => {
  ensureStyle(UI_CSS);
  let props = initial;
  const field = document.createElement('label');
  field.className = 'oc-sdk-field';
  const caption = document.createElement('span');
  caption.className = 'oc-sdk-field-label';
  const input = document.createElement('input');
  input.className = 'oc-sdk-field-input';
  field.append(caption, input);
  root.append(field);

  const paint = (): void => {
    caption.textContent = props.label;
    input.type = props.password ? 'password' : 'text';
    input.value = props.value;
    input.disabled = Boolean(props.disabled);
    if (props.placeholder) {
      input.placeholder = props.placeholder;
    } else {
      input.removeAttribute('placeholder');
    }
  };

  input.addEventListener('input', () => {
    props.onChange(input.value);
  });

  paint();

  return {
    update: (next) => {
      props = { ...props, ...next };
      paint();
    },
    dispose: () => {
      clearNode(field);
      field.remove();
    },
  };
};
