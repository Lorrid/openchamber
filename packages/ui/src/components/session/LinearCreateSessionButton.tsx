import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LinearIssuePickerDialog } from '@/components/session/LinearIssuePickerDialog';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useI18n } from '@/lib/i18n';
import { useLinearAuthStore } from '@/stores/useLinearAuthStore';

export function LinearCreateSessionButton({
  placement,
}: {
  placement: 'sidebar' | 'mobile';
}): React.ReactNode {
  const { t } = useI18n();
  const { linear } = useRuntimeAPIs();
  const connected = useLinearAuthStore((state) => state.status?.connected === true);
  const [open, setOpen] = React.useState(false);

  if (!linear || !connected) return null;

  const label = t('chat.chatInput.actions.newSessionFromLinearIssue');

  const trigger = placement === 'mobile' ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      onClick={() => setOpen(true)}
      style={{ touchAction: 'manipulation' }}
    >
      <Icon name="linear" className="size-4" />
    </Button>
  ) : (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
        >
          <Icon name="linear" className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <>
      {trigger}
      <LinearIssuePickerDialog open={open} onOpenChange={setOpen} mode="createSession" />
    </>
  );
}
