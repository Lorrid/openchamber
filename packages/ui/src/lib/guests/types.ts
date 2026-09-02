import type { AttachContribution, PublicIntegration } from '@openchamber/sdk';

export type GuestSource = 'bundled' | 'path' | 'zip' | 'git';

export type InstalledGuest = {
  id: string;
  name: string;
  icon: string;
  entry: string;
  attach?: AttachContribution;
  integration?: PublicIntegration;
  source?: GuestSource;
  path?: string | null;
};
