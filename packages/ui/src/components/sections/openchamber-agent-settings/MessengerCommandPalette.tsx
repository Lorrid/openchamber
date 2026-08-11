import React, { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { copyTextToClipboard } from '@/lib/clipboard';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  DISCORD_COMMANDS,
  MESSENGER_COMMAND_CATEGORY_ORDER,
  TELEGRAM_COMMANDS,
  type MessengerCommandCategory,
  type MessengerCommandPlatform,
  type DiscordCommandEntry,
  type TelegramCommandEntry,
} from './messenger-commands-data';

type PaletteCommand = DiscordCommandEntry | TelegramCommandEntry;

function platformKey(platform: MessengerCommandPlatform, suffix: string): I18nKey {
  return `settings.integrations.${platform}.commands.${suffix}` as I18nKey;
}

function commandText(cmd: PaletteCommand): string {
  return cmd.example ?? `/${cmd.name}`;
}

function commandsFor(platform: MessengerCommandPlatform): PaletteCommand[] {
  return platform === 'discord' ? DISCORD_COMMANDS : TELEGRAM_COMMANDS;
}

type MessengerCommandPaletteProps = {
  platform: MessengerCommandPlatform;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MessengerCommandPalette({
  platform,
  open,
  onOpenChange,
}: MessengerCommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const allCommands = commandsFor(platform);
  const categoryOrder = MESSENGER_COMMAND_CATEGORY_ORDER;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter(
      (cmd) =>
        cmd.name.includes(q) ||
        t(cmd.descriptionKey as I18nKey).toLowerCase().includes(q),
    );
  }, [allCommands, query, t]);

  const suggested = useMemo(
    () => filtered.filter((cmd) => cmd.suggested),
    [filtered],
  );

  const byCategory = useMemo(() => {
    const map = new Map<MessengerCommandCategory, PaletteCommand[]>();
    for (const cat of categoryOrder) {
      map.set(cat, []);
    }
    for (const cmd of filtered) {
      if (!cmd.suggested) {
        map.get(cmd.category)?.push(cmd);
      }
    }
    return map;
  }, [categoryOrder, filtered]);

  const handleCopy = async (cmd: PaletteCommand) => {
    const text = commandText(cmd);
    const result = await copyTextToClipboard(text);
    if (result.ok) {
      toast.success(t(platformKey(platform, 'copied')));
    }
  };

  const renderRow = (cmd: PaletteCommand) => (
    <li
      key={cmd.name}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--interactive-hover)]/50"
    >
      <code className="shrink-0 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[11px] text-foreground">
        /{cmd.name}
      </code>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {t(cmd.descriptionKey as I18nKey)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="h-7 shrink-0 px-2"
        onClick={() => void handleCopy(cmd)}
        aria-label={t(platformKey(platform, 'copy'))}
      >
        <Icon name="file-copy" className="size-3.5" />
      </Button>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3 p-5">
        <DialogHeader>
          <DialogTitle>{t(platformKey(platform, 'title'))}</DialogTitle>
          <DialogDescription>{t(platformKey(platform, 'description'))}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Icon
            name="search"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(platformKey(platform, 'search'))}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="max-h-[min(60vh,420px)] space-y-3 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t(platformKey(platform, 'noResults'))}
            </p>
          ) : (
            <>
              {suggested.length > 0 && (
                <section>
                  <h4 className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t(platformKey(platform, 'suggested'))}
                  </h4>
                  <ul className="space-y-0.5">{suggested.map(renderRow)}</ul>
                </section>
              )}
              {categoryOrder.map((cat) => {
                const items = byCategory.get(cat) ?? [];
                if (items.length === 0) return null;
                return (
                  <section key={cat}>
                    <h4 className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t(platformKey(platform, `category.${cat}`))}
                    </h4>
                    <ul className="space-y-0.5">{items.map(renderRow)}</ul>
                  </section>
                );
              })}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type MessengerCommandsButtonProps = {
  platform: MessengerCommandPlatform;
  className?: string;
};

export function MessengerCommandsButton({ platform, className }: MessengerCommandsButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className={cn('!font-normal', className)}
        onClick={() => setOpen(true)}
      >
        <Icon name="command" className="size-3.5" />
        {t(platformKey(platform, 'button'))}
      </Button>
      <MessengerCommandPalette platform={platform} open={open} onOpenChange={setOpen} />
    </>
  );
}
