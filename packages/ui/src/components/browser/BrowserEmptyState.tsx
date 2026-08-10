import React from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { OpenChamberLogo } from '@/components/ui/OpenChamberLogo';
import { useI18n } from '@/lib/i18n';
import { fetchDevServers, type DevServerDiscovery } from '@/lib/browser/devServers';

/**
 * What the panel shows before anything is loaded.
 *
 * Rather than an inert placeholder, this lists the servers actually listening
 * on the machine, which is almost always what the user came here to open.
 * Discovery failure is stated plainly instead of being rendered as "nothing is
 * running" — the two mean very different things to someone whose dev server is
 * definitely up.
 */
export const BrowserEmptyState: React.FC<{ onOpen: (url: string) => void }> = ({ onOpen }) => {
  const { t } = useI18n();
  const [discovery, setDiscovery] = React.useState<DevServerDiscovery>({ kind: 'loading' });

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetchDevServers(controller.signal).then((result) => {
      if (active) setDiscovery(result);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 overflow-y-auto bg-background p-6 text-center">
      <OpenChamberLogo width={110} height={110} className="opacity-20" />
      <div className="flex flex-col gap-1">
        <span className="typography-ui-header text-foreground">{t('contextPanel.browser.empty')}</span>
        <span className="typography-micro text-muted-foreground">{t('contextPanel.browser.emptyHint')}</span>
      </div>

      {discovery.kind === 'ready' && discovery.servers.length > 0 ? (
        <div className="flex w-full max-w-sm flex-col gap-1">
          <span className="typography-micro text-left text-muted-foreground">
            {t('contextPanel.browser.devServers.title')}
          </span>
          {discovery.servers.map((server) => (
            <Button
              key={server.port}
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => onOpen(server.url)}
            >
              <Icon name="global" className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{server.url}</span>
              {server.command ? (
                <span className="ml-auto truncate typography-micro text-muted-foreground">{server.command}</span>
              ) : null}
            </Button>
          ))}
        </div>
      ) : null}

      {discovery.kind === 'unavailable' ? (
        <span className="typography-micro text-muted-foreground">
          {t('contextPanel.browser.devServers.unavailable')}
        </span>
      ) : null}
    </div>
  );
};
