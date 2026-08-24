import { postLinearSessionStatus } from './status.js';

function extractSessionId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const props = payload.properties && typeof payload.properties === 'object'
    ? payload.properties
    : {};
  const info = props.info && typeof props.info === 'object' ? props.info : {};
  const sessionId = info.sessionID
    || info.sessionId
    || props.sessionID
    || props.sessionId
    || props.session
    || '';
  return typeof sessionId === 'string' ? sessionId.trim() : '';
}

function extractStatusType(payload) {
  if (!payload || payload.type !== 'session.status') return '';
  const props = payload.properties && typeof payload.properties === 'object'
    ? payload.properties
    : {};
  const status = props.status && typeof props.status === 'object' ? props.status : {};
  const info = props.info && typeof props.info === 'object' ? props.info : {};
  const type = typeof status.type === 'string'
    ? status.type
    : (typeof info.type === 'string' ? info.type : '');
  return type.trim();
}

function extractErrorName(payload) {
  if (!payload || payload.type !== 'session.error') return '';
  const props = payload.properties && typeof payload.properties === 'object'
    ? payload.properties
    : {};
  const error = props.error && typeof props.error === 'object' ? props.error : {};
  return typeof error.name === 'string' ? error.name.trim() : '';
}

export function createLinearSessionStatusRuntime() {
  let stopped = false;

  const processPayload = (payload) => {
    if (stopped) return;
    const sessionId = extractSessionId(payload);
    if (!sessionId) return;

    if (payload.type === 'session.error') {
      if (extractErrorName(payload) === 'MessageAbortedError') return;
      void postLinearSessionStatus({ kind: 'failure', sessionId }).catch((error) => {
        console.warn('[linear] failed to post session failure comment:', error?.message || error);
      });
      return;
    }

    if (extractStatusType(payload) !== 'idle') return;
    void postLinearSessionStatus({ kind: 'completed', sessionId }).catch((error) => {
      console.warn('[linear] failed to post session completed comment:', error?.message || error);
    });
  };

  const stop = () => {
    stopped = true;
  };

  return { processPayload, stop };
}
