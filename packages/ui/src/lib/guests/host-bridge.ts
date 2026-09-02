import {
  OPENCHAMBER_SDK_API_VERSION,
  OPENCHAMBER_SDK_CHANNEL,
  type AttachIssueRequest,
  type StartSessionRequest,
  type GuestConnection,
  type GuestMessage,
  type GuestRequest,
  type GuestRequestResult,
  type GuestSettings,
  type HostMessage,
  type HostReadyContext,
  type HostRequestErrorCode,
  type SessionSnapshot,
  type ToastKind,
} from '@openchamber/sdk';

import type { GuestRequestProxyResult } from '@/lib/guests/oauth';

import { isContextPanelMode, type ContextPanelMode } from '@/lib/surfaces/modes';

type HostBridgeEffects = {
  toast: (kind: ToastKind, message: string) => void;
  openUrl: (url: string) => Promise<boolean>;
  openSurface: (mode: ContextPanelMode) => void;
  writeClipboard: (text: string) => Promise<boolean>;
  compose: (text: string, mode: 'replace' | 'append') => void;
  attach: (issue: AttachIssueRequest) => void;
  startSession: (request: StartSessionRequest) => Promise<boolean>;
  close: () => void;
  oauthStart: () => Promise<boolean>;
  oauthDisconnect: () => Promise<boolean>;
  request: (request: GuestRequest) => Promise<GuestRequestProxyResult>;
};

export const buildReadyMessage = (payload: HostReadyContext): HostMessage => ({
  channel: OPENCHAMBER_SDK_CHANNEL,
  v: OPENCHAMBER_SDK_API_VERSION,
  type: 'ready',
  payload,
});

export const buildDirectoryMessage = (directory: string | null): HostMessage => ({
  channel: OPENCHAMBER_SDK_CHANNEL,
  v: OPENCHAMBER_SDK_API_VERSION,
  type: 'directory',
  payload: { directory },
});

export const buildSessionMessage = (session: SessionSnapshot | null): HostMessage => ({
  channel: OPENCHAMBER_SDK_CHANNEL,
  v: OPENCHAMBER_SDK_API_VERSION,
  type: 'session',
  payload: { session },
});

export const buildConnectionMessage = (connection: GuestConnection): HostMessage => ({
  channel: OPENCHAMBER_SDK_CHANNEL,
  v: OPENCHAMBER_SDK_API_VERSION,
  type: 'connection',
  payload: { connection },
});

export const buildSettingsMessage = (settings: GuestSettings): HostMessage => ({
  channel: OPENCHAMBER_SDK_CHANNEL,
  v: OPENCHAMBER_SDK_API_VERSION,
  type: 'settings',
  payload: { settings },
});

export const toGuestSessionSnapshot = (
  session: { id: string; title?: string | null } | null | undefined,
): SessionSnapshot | null => {
  if (!session?.id) return null;
  const title = session.title?.trim();
  return { id: session.id, title: title || session.id };
};

const okResult = (id: string, payload?: GuestRequestResult): HostMessage => {
  if (payload) {
    return {
      channel: OPENCHAMBER_SDK_CHANNEL,
      v: OPENCHAMBER_SDK_API_VERSION,
      type: 'result',
      id,
      ok: true,
      payload,
    };
  }
  return {
    channel: OPENCHAMBER_SDK_CHANNEL,
    v: OPENCHAMBER_SDK_API_VERSION,
    type: 'result',
    id,
    ok: true,
  };
};

const errorResult = (id: string, error: string, code: HostRequestErrorCode = 'HOST_REJECTED'): HostMessage => ({
  channel: OPENCHAMBER_SDK_CHANNEL,
  v: OPENCHAMBER_SDK_API_VERSION,
  type: 'result',
  id,
  ok: false,
  error,
  code,
});

const isHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export const answerGuestMessage = async (
  message: GuestMessage,
  effects: HostBridgeEffects,
): Promise<HostMessage | null> => {
  switch (message.type) {
    case 'hello':
      return null;
    case 'toast':
      effects.toast(message.payload.kind, message.payload.message);
      return okResult(message.id);
    case 'open-url': {
      if (!isHttpUrl(message.payload.url)) {
        return errorResult(message.id, 'URL must be http or https.');
      }
      const opened = await effects.openUrl(message.payload.url);
      return opened ? okResult(message.id) : errorResult(message.id, 'Could not open URL.');
    }
    case 'open-surface': {
      if (!isContextPanelMode(message.payload.surfaceId)) {
        return errorResult(message.id, 'Unknown surface.');
      }
      effects.openSurface(message.payload.surfaceId);
      return okResult(message.id);
    }
    case 'clipboard-write': {
      const copied = await effects.writeClipboard(message.payload.text);
      return copied ? okResult(message.id) : errorResult(message.id, 'Could not write clipboard.');
    }
    case 'compose':
      effects.compose(message.payload.text, message.payload.mode ?? 'append');
      return okResult(message.id);
    case 'attach': {
      if (!isHttpUrl(message.payload.url)) {
        return errorResult(message.id, 'URL must be http or https.');
      }
      effects.attach(message.payload);
      return okResult(message.id);
    }
    case 'start-session': {
      if (!isHttpUrl(message.payload.url)) {
        return errorResult(message.id, 'URL must be http or https.');
      }
      const started = await effects.startSession(message.payload);
      return started ? okResult(message.id) : errorResult(message.id, 'Could not start that session.');
    }
    case 'close':
      effects.close();
      return okResult(message.id);
    case 'oauth-start': {
      const started = await effects.oauthStart();
      return started ? okResult(message.id) : errorResult(message.id, 'Could not start OAuth.');
    }
    case 'oauth-disconnect': {
      const disconnected = await effects.oauthDisconnect();
      return disconnected ? okResult(message.id) : errorResult(message.id, 'Could not disconnect.');
    }
    case 'request': {
      const result = await effects.request(message.payload);
      if (!result.ok) {
        return errorResult(message.id, result.message, result.code);
      }
      return okResult(message.id, result.result);
    }
  }
};
