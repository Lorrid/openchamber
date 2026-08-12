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
        className={cn(
          'w-6 shrink-0 rounded-full px-0 text-muted-foreground',
          'hover:text-foreground',
          pressed && 'text-foreground',
        )}
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
  /** These need a real Chromium host; hidden without one. */
  onAnnotate?: () => void;
  onOpenDevTools?: () => void;
  isAnnotating?: boolean;
  onHardReload?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  /** Whole percent, e.g. 110. Controls hide at 100 to keep the bar quiet. */
  zoomPercent?: number;
  onClearCookies?: () => void;
  onClearCache?: () => void;
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
  onHardReload,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  zoomPercent = 100,
  onClearCookies,
  onClearCache,
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
      {onHardReload ? (
        <ToolbarButton icon="restart" label={t('contextPanel.browser.hardReload')} onClick={onHardReload} />
      ) : null}
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
            'h-6 w-full rounded-full border border-border/50 bg-[var(--surface-elevated)] px-3',
            'typography-micro text-foreground outline-none focus:border-[var(--interactive-focus-ring)]',
          )}
          aria-label={t('contextPanel.browser.addressAria')}
        />
      </form>
      {onZoomOut && onZoomIn ? (
        <div className="flex shrink-0 items-center">
          <ToolbarButton icon="subtract" label={t('contextPanel.browser.zoomOut')} onClick={onZoomOut} />
          {zoomPercent !== 100 && onZoomReset ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="shrink-0 rounded-full px-1.5 typography-micro tabular-nums text-muted-foreground"
                  onClick={onZoomReset}
                  aria-label={t('contextPanel.browser.zoomReset')}
                >
                  {zoomPercent}%
                </Button>
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>{t('contextPanel.browser.zoomReset')}</TooltipContent>
            </Tooltip>
          ) : null}
          <ToolbarButton icon="add" label={t('contextPanel.browser.zoomIn')} onClick={onZoomIn} />
        </div>
      ) : null}
      {onClearCookies ? (
        <ToolbarButton icon="delete-bin" label={t('contextPanel.browser.clearCookies')} onClick={onClearCookies} />
      ) : null}
      {onClearCache ? (
        <ToolbarButton icon="database-2" label={t('contextPanel.browser.clearCache')} onClick={onClearCache} />
      ) : null}
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
