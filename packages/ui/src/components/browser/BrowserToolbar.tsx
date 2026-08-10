import React from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { IconName } from '@/components/icon/icons';

type ToolbarButtonProps = {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
};

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ icon, label, onClick, disabled, pressed }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        type="button"
        variant={pressed ? 'secondary' : 'ghost'}
        size="xs"
        className="w-6 shrink-0 px-0"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
      >
        <Icon name={icon} className="size-3.5" aria-hidden="true" />
      </Button>
    </TooltipTrigger>
    <TooltipContent sideOffset={6}>{label}</TooltipContent>
  </Tooltip>
);

export type BrowserToolbarProps = {
  address: string;
  onAddressChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onOpenExternal: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  /** Annotation and devtools need a real Chromium host; hidden without one. */
  onAnnotate?: () => void;
  onOpenDevTools?: () => void;
  isAnnotating?: boolean;
};

export const BrowserToolbar: React.FC<BrowserToolbarProps> = ({
  address,
  onAddressChange,
  onSubmit,
  onBack,
  onForward,
  onReload,
  onOpenExternal,
  canGoBack,
  canGoForward,
  isLoading,
  onAnnotate,
  onOpenDevTools,
  isAnnotating,
}) => {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-1 border-b border-border bg-[var(--surface-background)] px-2 py-1">
      <ToolbarButton icon="arrow-left" label={t('contextPanel.browser.back')} onClick={onBack} disabled={!canGoBack} />
      <ToolbarButton icon="arrow-right" label={t('contextPanel.browser.forward')} onClick={onForward} disabled={!canGoForward} />
      <ToolbarButton
        icon="refresh"
        label={isLoading ? t('contextPanel.browser.stop') : t('contextPanel.browser.reload')}
        onClick={onReload}
      />
      <form
        className="min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(address);
        }}
      >
        <input
          value={address}
          onChange={(event) => onAddressChange(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          className={cn(
            'h-6 w-full rounded-md border border-border/50 bg-[var(--surface-elevated)] px-2',
            'typography-micro text-foreground outline-none focus:border-[var(--interactive-focus-ring)]',
          )}
          aria-label={t('contextPanel.browser.addressAria')}
        />
      </form>
      {onAnnotate ? (
        <ToolbarButton
          icon="cursor"
          label={t('contextPanel.browser.annotate.toggle')}
          onClick={onAnnotate}
          pressed={isAnnotating}
        />
      ) : null}
      {onOpenDevTools ? (
        <ToolbarButton icon="terminal-box" label={t('contextPanel.browser.devTools')} onClick={onOpenDevTools} />
      ) : null}
      <ToolbarButton icon="external-link" label={t('contextPanel.browser.openExternal')} onClick={onOpenExternal} />
    </div>
  );
};
