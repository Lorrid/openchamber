# Messenger module

## Purpose

This module owns the Discord and Telegram integrations: bot listeners that
receive inbound messages, the bridge that forwards them to OpenCode and
mirrors streamed responses back, project/worktree ↔ channel synchronization,
and the `/api/messenger/*` HTTP + WebSocket surface the Settings UI and CLI
use to configure everything.

## Entrypoints and structure

- `messenger-sync.js`: Express router for `/api/messenger` (mounted once in
  `server/index.js`). Owns listener start/stop/status routes, config
  save/load, project/worktree sync endpoints, and the table-driven
  `/bridge/*` default-setting routes (`verbosity`, `permission-mode`,
  `notify-on-complete`, `critique`, `interrupt-timeout`). Exports
  `createMessengerSyncRouter`, `buildDiscordResolveProject`,
  `buildTelegramResolveProject`, and path/binding helpers.
- `messenger-autostart.js`: boot-time listener lifecycle. Starts both
  listeners from saved settings with retries, then runs a per-messenger
  health check that stops disabled listeners and restarts crashed ones. Both
  here and in the routes, start options are built through the same
  `build*ResolveProject` resolvers so boot and manual start cannot drift.
- `messenger-opencode-bridge.js`: the OpenCode bridge — routes inbound
  messenger messages into OpenCode sessions, mirrors session events
  (parts, permissions, questions, todos) back into the originating
  channel/topic, and keeps `settings.{discord,telegram}.projectBindings`
  in sync.
- `messenger-commands.js`: in-chat slash/dot command execution (`/model`,
  `/agent`, `/queue`, `/undo`, …) shared by both messengers.
- `discord-listener.js` / `telegram-listener.js`: gateway/long-poll listener
  registries keyed by bot token. `bridgeEnabled` is not user-configurable;
  per-server/per-chat `*Policies[*].enabled` is the only mute.
- `discord-commands.js`, `discord-command-wizards.js`,
  `discord-model-wizard.js`, `discord-wizard-shared.js`: Discord slash-command
  registration and interactive wizard UI.
- `telegram-api.js`, `telegram-access.js`, `telegram-format.js`,
  `telegram-command-wizards.js`, `telegram-model-wizard.js`,
  `telegram-wizard-ui.js`: Telegram Bot API helpers, access policy, HTML
  formatting, and inline-keyboard wizards.
- `messenger-bridge-store.js`: persistent bridge store (bindings, defaults,
  interrupt timeouts, notify-on-complete).
- `messenger-render.js`, `messenger-attachments.js`, `messenger-critique.js`,
  `messenger-git-diff.js`, `messenger-undo-redo.js`, `messenger-verbosity.js`,
  `messenger-permissions.js`: rendering, attachment, critique.work, diff, and
  undo/redo helpers.
- `messenger-worktree-sync.js` / `messenger-worktrees.js`: project channel and
  worktree thread lifecycle mirroring.
- `discord-agent-api.js`: agent-facing router under `/api/messenger/agent`
  (`post`, `schedule`, `read-session`, `resolve-reference`, `create-project`)
  used by system skills and the `openchamber messenger send` CLI.
- `session-reference.js`: `@session:<id>` reference parsing/resolution and
  transcript export.
- `websocket.js`: messenger events WebSocket at `/api/messenger/ws`
  (`messenger.bridge.*` events to the UI).

## Invariants

- Listener start options are identical between boot auto-start and route
  start — both go through the shared resolvers in `messenger-sync.js`.
- A persisted `listenerEnabled: false` (Disconnect/Stop) is always respected:
  health checks re-read settings every tick and never resurrect a stopped
  listener.
- Bridge failures are explicit: one channel/topic failure must not erase or
  block unrelated bindings.
- Bot tokens never appear in route responses (`load-config` reports
  `hasToken` instead).
- Two independent mute switches, enforced identically on Discord and
  Telegram, in BOTH directions: the integration toggle
  (`{discord,telegram}.listenerEnabled: false`) and the per-server/per-chat
  switch (`discord.guildPolicies[guildId].enabled`,
  `telegram.chatPolicies[chatId].enabled`). The listeners apply this to
  inbound messages, slash commands, and component clicks; the bridge's
  `isSurfaceEnabled` applies it to every outbound path (chat mirroring,
  approvals, questions, todo updates, and the agent-facing `/post` route).
  A muted surface exchanges nothing in either direction and re-enabling
  restores it immediately (no restart required — the health check and
  `isSurfaceEnabled` both re-read settings live).
- Project↔messenger surface sync (channel/topic auto-create, rename, delete)
  runs on project add/rename/remove, not only on manual "Sync now", for
  every Discord server and Telegram chat whose policy has
  `syncProjects: true` — see `autoCreateMessengerSurfacesForProject` and the
  `/bridge/project-added|renamed|removed` routes in `messenger-sync.js`. A
  muted server/chat is skipped for these maintenance actions the same way it
  is for messages.

## Related modules

- `packages/web/server/lib/message-queue/`: shared server-owned message queue
  (`/queue` command and the web UI write into the same queue).
- `packages/web/server/lib/opencode/system-skills.js`: managed skills that
  call `/api/messenger/agent/*`.
- `packages/web/server/lib/projects/project-bootstrap.js`: project
  clone/path/new bootstrap used by the agent create-project API.
- UI side: `packages/ui/src/stores/useMessengerStore.ts` and
  `packages/ui/src/components/sections/openchamber-agent-settings/`.
