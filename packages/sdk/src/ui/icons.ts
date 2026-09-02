const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON_PATH = {
  search: 'M18.031 16.617l4.283 4.282-1.415 1.415-4.282-4.283A8.96 8.96 0 0 1 11 20c-4.968 0-9-4.032-9-9s4.032-9 9-9 9 4.032 9 9a8.96 8.96 0 0 1-1.969 5.617zm-2.006-.742A6.977 6.977 0 0 0 18 11c0-3.868-3.133-7-7-7-3.868 0-7 3.132-7 7 0 3.867 3.132 7 7 7a6.977 6.977 0 0 0 4.875-1.975l.15-.15z',
  status: 'M19 4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h14zm-1 2H6v12h12V6zm-3 7v2H8v-2h7zm0-4v2H8V9h7z',
  priority: 'M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM11 7h2v6h-2V7zm0 8h2v2h-2v-2z',
  assignee: 'M20 22h-2v-2a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3v2H4v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2zm-8-9a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  team: 'M9 14.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0-2a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM15.881 14.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm0-2a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM2 20.5a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1H2v-1zm13.5 0a4.5 4.5 0 0 1 3.032-4.254 4.98 4.98 0 0 1 2.968.24A4.5 4.5 0 0 1 24 20.5V21.5h-8.5v-1z',
  chevron: 'M12 13.172l4.95-4.95 1.414 1.414L12 16 5.636 9.636 7.05 8.222z',
  back: 'M10.828 12l4.95 4.95-1.414 1.414L8 12l6.364-6.364 1.414 1.414z',
  check: 'M10 15.172l9.192-9.193 1.415 1.414L10 18l-6.364-6.364 1.414-1.414z',
  open: 'M10 6v2H5v11h11v-5h2v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6zm11-3v8h-2V6.413l-7.793 7.794-1.414-1.414L17.585 5H13V3h8z',
  close: 'M12 10.586l4.95-4.95 1.414 1.414-4.95 4.95 4.95 4.95-1.414 1.414-4.95-4.95-4.95 4.95-1.414-1.414 4.95-4.95-4.95-4.95L7.05 5.636z',
} as const;

type IconName = keyof typeof ICON_PATH;

export const icon = (name: IconName, size: number, className?: string): SVGSVGElement => {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('width', String(size));
  node.setAttribute('height', String(size));
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('fill', 'currentColor');
  if (className) {
    node.setAttribute('class', className);
  }
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATH[name]);
  node.append(path);
  return node;
};
