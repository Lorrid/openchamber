import type { GuestHostSurface, HostTheme } from '../protocol.ts';

export type ThemeRoot = {
  style: {
    colorScheme: string;
    setProperty: (name: string, value: string) => void;
  };
  dataset?: {
    ocSurface?: string;
    ocTheme?: string;
  };
};

const TOKEN_VARS = [
  ['--oc-bg', 'background'],
  ['--oc-elevated', 'elevated'],
  ['--oc-fg', 'foreground'],
  ['--oc-muted', 'muted'],
  ['--oc-subtle', 'subtle'],
  ['--oc-border', 'border'],
  ['--oc-hover', 'hover'],
  ['--oc-selection', 'selection'],
  ['--oc-focus', 'focus'],
  ['--oc-primary', 'primary'],
  ['--oc-font', 'font'],
  ['--oc-radius', 'radius'],
  ['--surface-background', 'background'],
  ['--surface-elevated', 'elevated'],
  ['--surface-foreground', 'foreground'],
  ['--surface-muted-foreground', 'muted'],
  ['--surface-subtle', 'subtle'],
  ['--interactive-border', 'border'],
  ['--interactive-hover', 'hover'],
  ['--interactive-selection', 'selection'],
  ['--interactive-focus-ring', 'focus'],
  ['--primary', 'primary'],
  ['--font-sans', 'font'],
  ['--radius', 'radius'],
] as const;

/** Paint the host theme onto the iframe root. Guest chrome reads these variables. */
export const applyHostTheme = (theme: HostTheme, root: ThemeRoot): void => {
  root.style.colorScheme = theme.mode;
  for (const [name, key] of TOKEN_VARS) {
    root.style.setProperty(name, theme.tokens[key]);
  }
};

export const applyHostReady = (
  ctx: { theme: HostTheme; surface: GuestHostSurface },
  root: ThemeRoot,
): void => {
  applyHostTheme(ctx.theme, root);
  if (root.dataset) {
    root.dataset.ocSurface = ctx.surface;
    root.dataset.ocTheme = ctx.theme.mode;
  }
};
