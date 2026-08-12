# Message queue module

## Purpose

Server-owned, in-memory message queue for OpenChamber sessions. One queue per
`(directory, sessionId)`. Both producers share this module:

- the web/desktop/mobile UI via `/api/message-queue` routes, and
- messenger surfaces (Discord `/queue`, `. queue` suffix) via direct
  in-process calls from the messenger bridge.

The runtime is also the single drainer: it watches the global OpenCode event
hub and sends the head item once the session settles to idle, so a queued
message is delivered exactly once no matter which surface queued it. Items
carry the send configuration captured at queue time (provider/model/agent/
variant) — nothing is re-resolved at send time.

## Files

- `runtime.js`: queue state, caps (`MAX_QUEUE_TARGETS`, `MAX_MESSAGES_PER_QUEUE`),
  drain loop with exponential backoff, and the `MESSAGE_QUEUE_CHANGED_EVENT` /
  `MESSAGE_QUEUE_DRAINED_EVENT` notifications.
- `routes.js`: `/api/message-queue` HTTP surface for the UI.

## Invariants

- State is deliberately ephemeral (memory only) — a restart clears queues.
- Bounded: excess targets/messages are rejected, never silently dropped.
- A drain failure retries with backoff and must not lose the head item.
