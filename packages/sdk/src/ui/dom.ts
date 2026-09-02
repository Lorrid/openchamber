const STYLE_ID = 'oc-sdk-ui-style';

export const clearNode = (node: Element): void => {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
};

export const ensureStyle = (css: string): void => {
  const existing = document.getElementById(STYLE_ID);
  if (existing instanceof HTMLStyleElement) {
    if (existing.textContent !== css) {
      existing.textContent = css;
    }
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
};
