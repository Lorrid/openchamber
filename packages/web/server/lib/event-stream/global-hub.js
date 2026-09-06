import { createUpstreamSseReader } from './upstream-reader.js';
import { getPathMapping } from '../opencode/path-mapping.js';

// TEMPORARY diagnostics for docker instance event routing (removed after the
// routing issue is confirmed fixed).
const DOCKER_DIAG = process.env.OPENCHAMBER_DOCKER_DIAG === '1';

// Raised from 512 → 2048 to improve recovery after brief disconnects during
// long-running agent sessions where many events accumulate quickly.
const MESSAGE_STREAM_GLOBAL_REPLAY_LIMIT = 2048;

export function createGlobalMessageStreamHub({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  fetchImpl = fetch,
  upstreamStallTimeoutMs,
  upstreamReconnectDelayMs,
  replayLimit = MESSAGE_STREAM_GLOBAL_REPLAY_LIMIT,
}) {
  const eventSubscribers = new Set();
  const statusSubscribers = new Set();
  const replay = [];

  let controller = null;
  let reader = null;
  let connected = false;
  let everConnected = false;
  let buildUrlFailed = false;

  const notifySubscriber = (kind, subscriber, payload) => {
    try {
      const result = subscriber(payload);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => {
          console.warn(`Global message stream ${kind} subscriber failed:`, error);
        });
      }
    } catch (error) {
      console.warn(`Global message stream ${kind} subscriber failed:`, error);
    }
  };

  const notifyStatus = (status) => {
    for (const subscriber of Array.from(statusSubscribers)) {
      notifySubscriber('status', subscriber, status);
    }
  };

  const toHostDirectory = (value) => {
    if (typeof value !== 'string' || !value.startsWith('/')) {
      return value;
    }
    return getPathMapping().toHost(value) || value;
  };

  // Session payloads carry the directory the UPSTREAM saw (e.g. /workspace in
  // a docker container). The UI's sync layer routes session.created/updated
  // and groups the sidebar by that directory, so it must be restored to the
  // host spelling exactly like session list responses. Unmapped/POSIX-global
  // values pass through untouched.
  const mapPayloadSessionDirectories = (payload) => {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }
    const properties = payload.properties && typeof payload.properties === 'object' ? payload.properties : null;
    if (!properties) {
      return payload;
    }
    let changed = false;
    const nextProperties = { ...properties };
    if (typeof nextProperties.directory === 'string' && nextProperties.directory.startsWith('/')) {
      const mapped = toHostDirectory(nextProperties.directory);
      if (mapped !== nextProperties.directory) {
        nextProperties.directory = mapped;
        changed = true;
      }
    }
    const info = nextProperties.info && typeof nextProperties.info === 'object' ? { ...nextProperties.info } : null;
    if (info && typeof info.directory === 'string' && info.directory.startsWith('/')) {
      const mapped = toHostDirectory(info.directory);
      if (mapped !== info.directory) {
        info.directory = mapped;
        nextProperties.info = info;
        changed = true;
      }
    }
    if (!changed) {
      return payload;
    }
    return { ...payload, properties: nextProperties };
  };

  const normalizeEvent = ({ envelope, payload }) => {
    const rawDirectory =
      typeof envelope?.directory === 'string' && envelope.directory.length > 0 ? envelope.directory : 'global';
    // Docker-backed upstreams emit container paths (e.g. /workspace); the UI
    // routes and groups global events by the HOST spelling (same as session
    // list responses). toHost restores the host prefix for mapped container
    // paths and passes everything else through untouched, so the Local
    // upstream's behavior is byte-identical.
    const directory = toHostDirectory(rawDirectory) || rawDirectory;
    const eventId = typeof envelope?.eventId === 'string' && envelope.eventId.length > 0 ? envelope.eventId : undefined;
    const mappedPayload = mapPayloadSessionDirectories(payload);
    if (DOCKER_DIAG && typeof mappedPayload?.type === 'string' && mappedPayload.type.startsWith('session.')) {
      console.log(`[docker-diag:hub] ${mappedPayload.type} envelopeDir=${rawDirectory} finalDir=${directory} payloadInfoDir=${typeof mappedPayload?.properties?.info?.directory === 'string' ? mappedPayload.properties.info.directory : '(none)'}`);
    }
    return {
      envelope: envelope?.directory && directory !== envelope.directory
        ? { ...envelope, directory }
        : envelope,
      payload: mappedPayload,
      directory,
      eventId,
    };
  };

  const start = () => {
    if (reader) {
      return;
    }

    controller = new AbortController();
    reader = createUpstreamSseReader({
      signal: controller.signal,
      stallTimeoutMs: upstreamStallTimeoutMs,
      reconnectDelayMs: upstreamReconnectDelayMs,
      fetchImpl,
      buildUrl: () => {
        buildUrlFailed = false;
        try {
          return new URL(buildOpenCodeUrl('/global/event', ''));
        } catch {
          buildUrlFailed = true;
          throw new Error('OpenCode service unavailable');
        }
      },
      getHeaders: getOpenCodeAuthHeaders,
      onConnect() {
        connected = true;
        const wasReady = everConnected;
        everConnected = true;
        notifyStatus({ type: 'connect', wasReady });
      },
      onDisconnect({ reason }) {
        connected = false;
        notifyStatus({ type: 'disconnect', reason });
      },
      onEvent(event) {
        const normalized = normalizeEvent(event);
        if (normalized.eventId) {
          replay.push(normalized);
          if (replay.length > replayLimit) {
            replay.splice(0, replay.length - replayLimit);
          }
        }

        for (const subscriber of Array.from(eventSubscribers)) {
          notifySubscriber('event', subscriber, normalized);
        }
      },
      onError(error) {
        if (controller?.signal.aborted) {
          return;
        }

        notifyStatus({
          type: everConnected ? 'error' : 'initial-error',
          error,
          buildUrlFailed,
        });
      },
    });

    void reader.start();
  };

  const stop = () => {
    connected = false;
    reader?.stop();
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    reader = null;
    controller = null;
    everConnected = false;
    buildUrlFailed = false;
  };

  return {
    start,
    stop,
    isConnected() {
      return connected;
    },
    hasConnected() {
      return everConnected;
    },
    subscribeEvent(subscriber) {
      eventSubscribers.add(subscriber);
      return () => {
        eventSubscribers.delete(subscriber);
      };
    },
    subscribeStatus(subscriber) {
      statusSubscribers.add(subscriber);
      return () => {
        statusSubscribers.delete(subscriber);
      };
    },
    replayAfter(eventId) {
      if (!eventId) {
        return [];
      }

      const index = replay.findIndex((entry) => entry.eventId === eventId);
      return index === -1 ? [] : replay.slice(index + 1);
    },
  };
}
