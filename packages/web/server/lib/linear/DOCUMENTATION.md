# Linear Module Documentation

## Purpose

This module owns Linear OAuth, issue lookup, Linear-team-to-project mapping, issue status updates, and session status comments on Linear issues. Credentials live on the OpenChamber server, so web, desktop, and a phone paired to that host share them. You can store more than one Linear workspace; exactly one is current. Issue list, mapping, and new OAuth default to the current workspace. Session status comments use the workspace that started the session. The right-hand context panel lists issues for the current workspace, can switch workspace, filters the list, shows a read-only card, changes status or closes the issue, and starts a session or worktree. Start session stays visible in a footer while the issue card scrolls. The chat picker lists issues and attaches them to a message. New Worktree can also start from a Linear issue in the currently active project. A session started from a Linear issue posts started/completed/failure comments, each with an OpenChamber session link.

VS Code omits Linear (`RuntimeAPIs.linear` is optional). Hide Linear UI when the API is missing.

## Entrypoints and structure

- `packages/web/server/lib/linear/index.js`: public server entrypoint. `routes.js` loads it lazily with `await import('./index.js')`.
- `packages/web/server/lib/linear/routes.js`: Express registration for the public callback, `/api/linear/auth/*`, `/api/linear/issues/*`, `/api/linear/mapping`, and `/api/linear/session-status`.
- `packages/web/server/lib/linear/auth.js`: auth file, client id, scopes, redirect URI.
- `packages/web/server/lib/linear/oauth.js`: authorization-code + PKCE S256, refresh, revoke.
- `packages/web/server/lib/linear/client.js`: GraphQL helper, viewer/organization lookup, and access-token refresh. GraphQL errors prefer `extensions.userPresentableMessage` / validation constraints over the generic `Argument Validation Error` label. User-facing Linear errors set `LinearApiError.userError`. Requests send `public-file-urls-expire-in: 3600` so file URLs in issue descriptions and comments are temporarily readable in the panel.
- `packages/web/server/lib/linear/issues.js`: list/search/get issues, team workflow states, `issueUpdate`, and `commentCreate`. Parses identifiers and Linear URLs. `issueUpdate` resolves identifiers to UUIDs first because Linear's mutation does not accept `ENG-12`. List/get include `state.id`, `priority` (0–4), and labels (`id`, `name`, sanitized hex `color`) so the panel can show them and update status.
- `packages/web/server/lib/linear/teams.js`: list Linear teams for mapping UI.
- `packages/web/server/lib/linear/mapping.js`: persist default and per-team OpenChamber project paths. Separate from the auth file so disconnect does not wipe maps.
- `packages/web/server/lib/linear/status.js`: persist per-session started/completed/failure flags and post the matching Linear comment with an open-session URL.
- `packages/web/server/lib/linear/status-runtime.js`: on the OpenCode event hub, first `session.status` idle after started posts completed once; `session.error` (except abort) posts failure once.
- `packages/web/src/api/linear.ts`: web client wrapper. Electron and hosted/Capacitor mobile reuse it. VS Code omits `linear`.

## Public routes

- `GET /linear/oauth/callback`: public. Linear redirects the system browser here. Safe without a UI session because it only completes a `code` whose `state` matches a pending PKCE verifier created by an authenticated start call.
- `GET /api/linear/auth/status`: connected flag, current user/organization/scope, and `workspaces` (id, name, current, user, authorizedAt). Never returns tokens. A 401 on the current workspace drops that workspace only; if another remains, status returns that one instead of disconnected. Identity refresh does not bump `authorizedAt`.
- `POST /api/linear/auth/start`: returns `{ authorizationUrl, expiresIn, scope }`. Body may include `origin: "desktop"` so the callback page can raise the desktop window. The authorize URL uses `prompt=consent` so Add workspace can pick a different Linear org. Completing OAuth stores or replaces that org and makes it current.
- `POST /api/linear/auth/activate`: body `{ organizationId }`. Makes that stored workspace current. 400 if the id is missing, 404 if it is not stored.
- `DELETE /api/linear/auth`: revokes the current workspace refresh token when present, then drops that workspace only. Other stored workspaces stay. Mapping is kept.
- `GET /api/linear/issues/list?query=&cursor=&status=&assignee=&teamId=&priority=`: issues from the current workspace. Omitted `status` is incomplete states (same as the chat picker). The panel sends `all`, `backlog`, `todo` (Linear `unstarted`), `started` (In Progress, excluding the In Review name), `inReview` (state name In Review), `completed` (Done), `canceled` (excluding the Duplicate name), or `duplicate` (state type or name Duplicate). `assignee` is `any` (default) or `me`. `teamId` limits the list to that Linear team. `priority` is `all` (default), `none`, `urgent`, `high`, `medium`, or `low`. An identifier or Linear URL returns that issue even if it is completed and ignores the other filters. Each issue includes `state.id` when Linear sends it, plus `priority` (0 none through 4 low) and `labels`. Never returns tokens.
- `GET /api/linear/issues/get?id=`: one issue by UUID or identifier, including description, comments, team, `state.id`, priority, and labels.
- `GET /api/linear/issues/states?teamId=`: workflow states for that Linear team (`id`, `name`, `type`, `position`), ordered like Linear's workflow: type (backlog, unstarted, started, completed, canceled) then position. Missing `teamId` is 400. Linear not-found or validation errors are 400 with Linear's presentable message. Disconnected is `{ connected: false }` with HTTP 200.
- `POST /api/linear/issues/update`: body `{ id, stateId }`. `id` may be a UUID, identifier, or Linear URL; identifiers are resolved before `issueUpdate` because Linear's mutation requires a UUID. Returns the updated issue. Closing an issue is this same call with the team's first `type: completed` state. Missing `id` or `stateId` is 400. Linear validation (for example a non-UUID `stateId`) is 400 with Linear's presentable message. A GraphQL 401 clears that workspace only. Disconnected is `{ connected: false }` with HTTP 200.
- `GET /api/linear/mapping`: stored default project plus live Linear teams with their mapped paths. Missing file is empty mapping. Malformed file is 500, not empty success. Disconnected is `{ connected: false }` with HTTP 200.
- `PUT /api/linear/mapping`: replace default project and per-team paths. Body `{ defaultProjectPath, teamProjectPaths }`. Failed write does not touch tokens. Disconnected is `{ connected: false }` and does not save.
- `POST /api/linear/session-status`: post a started/completed/failure comment on the linked Linear issue. Body `{ kind, sessionId, issueIdentifier?, sessionOrigin?, sessionTitle? }`. `started` requires `issueIdentifier`. `completed` and `failure` reuse the stored issue, open URL, and session title from `started`. Each kind posts at most once per session. `sessionOrigin` must be `http` or `https` with no path, or `openchamber:` for a desktop `openchamber://session/<id>` link; otherwise the comment uses `http://127.0.0.1:<listen-port>`. Comment bodies are one markdown link: `[OpenChamber session started: Title](url)` so Linear keeps the `?session=` query. Missing title falls back to the session id. Disconnected is `{ connected: false }` with HTTP 200. Invalid body is 400.

`POST /api/linear/auth/start`, `PUT /api/linear/mapping`, `POST /api/linear/issues/update`, and `POST /api/linear/session-status` parse JSON on the route (`16kb`). They are not on the `/api` 50mb allowlist.

Disconnected list/get/states/update/mapping/session-status return `{ connected: false }` with HTTP 200 so the picker and panel can show an empty state. Missing `id` on get is 400. Missing `teamId` on states is 400.

## Auth storage and config

- Auth storage: `~/.config/openchamber/linear-auth.json` (or `$OPENCHAMBER_DATA_DIR/linear-auth.json`). Shape is `{ workspaces: [ { accessToken, refreshToken, user, organization, workspaceId, current, authorizedAt, ... } ] }`. `workspaceId` is the Linear organization id, or `user:<id>` when there is no org, or `legacy` for a migrated token with neither. A legacy single-object file is rewritten to this list on read. Reconnecting the same org replaces that slot.
- Mapping storage: `~/.config/openchamber/linear-mapping.json` (same data dir). Shape is `{ workspaces: { [workspaceId]: { defaultProjectPath, teamProjectPaths } } }`. Reads and writes use the current workspace slice. A legacy flat file is wrapped under the current workspace id on read. Disconnect does not wipe maps. Writes are atomic and file mode is `0o600`.
- Session status storage: `~/.config/openchamber/linear-session-status.json` (same data dir). Writes are atomic and file mode is `0o600`. Dedupes started/completed/failure per OpenChamber session id.
- Writes are atomic and file mode is `0o600`.
- Client ID: `OPENCHAMBER_LINEAR_CLIENT_ID` -> `settings.json` `linearClientId` -> baked-in public default.
- Client secret: `OPENCHAMBER_LINEAR_CLIENT_SECRET` -> `settings.json` `linearClientSecret`. Optional with PKCE. Do not commit a secret.
- Scopes: `OPENCHAMBER_LINEAR_SCOPES` -> `settings.json` `linearScopes` -> `read,write,comments:create`.
- Redirect URI: `OPENCHAMBER_LINEAR_REDIRECT_URI` -> `settings.json` `linearRedirectUri` -> `http://127.0.0.1:<listen-port>/linear/oauth/callback`.

Linear requires an exact callback match. Production listens on 3000; `bun oc-dev` listens on 3001 unless `OPENCHAMBER_PORT` is set. Register every listen origin you actually use.

## OAuth contract

- Authorization code + PKCE S256. Linear has no device flow.
- Access tokens expire in 24 hours. Refresh tokens rotate; persist the new refresh token from every successful refresh. Concurrent refreshes share one in-flight promise per workspace.
- `invalid_grant` / 401 on refresh clears that workspace only so a dead token cannot loop. If it was the last workspace, status becomes disconnected.
- A GraphQL 401 after a valid-looking token also clears that workspace. A network failure while a token is stored does not: status stays connected with the last known user.

## Project mapping

OpenChamber has projects (directories), not accounts or organizations. Mapping is how create-session (picker and the right-hand panel) picks a directory:

1. If the issue's Linear team has a project path, use that.
2. Otherwise use the default project path.
3. If neither is set, the UI tells the user to map the team in Settings → Integrations. It does not fall back to the currently active project.

A worktree started from the panel or picker is created in that mapped project. New Worktree from Git is different: it stays in the currently active project.

## Shared UI

- `RuntimeAPIs.linear` is optional. Hide Linear settings, the chat picker, and the panel when it is missing (VS Code).
- Store: `packages/ui/src/stores/useLinearAuthStore.ts`. App start refreshes it from `App.tsx` and `MobileApp.tsx`, not `VSCodeApp`.
- Settings: first-party section on the Integrations page. Connect opens the authorization URL and polls status until the workspace list or current `authorizedAt` changes, so Add workspace is not treated as done just because a workspace was already connected. When connected, map a default project and optional per-team projects for the current workspace. Other stored workspaces appear in a list with Switch to. Disconnect removes the current workspace only. The panel can also switch the current workspace when more than one is stored.
- Context panel: desktop/web right-hand rail surface `linear` (`packages/ui/src/components/views/LinearIssuesView.tsx`). Singleton like git/pr. The rail icon is hidden until a Linear workspace is connected; disconnecting while the panel is open closes it. List/search defaults to all issues; the status filter is All, Backlog, To Do, In Progress, In Review, Done, Canceled, and Duplicate, matching the card status order. Identifier/URL still finds completed. Status, assignee, team, and priority filters persist in `useUIStore` so they survive rail switches. Changing those filters keeps the previous list until the next page arrives and does not disable the filter row. On a narrow panel search and the filters other than status drop to icons; status keeps its label. The card shows priority and labels. The card is read-only except status (`issueUpdate`) and Close (first completed workflow state). Start session stays in a footer while the description and comments scroll. Start session / worktree share `startLinearIssueSession` with the picker. No create-issue, no writing comments, no polling. VS Code and the mobile workspace drawer omit this rail.
- Chat: composer attach menu "Link Linear Issue" attaches body and comments as `linear-issue` context on the next send. Exclusive with a linked GitHub issue or PR. The attached issue is stored on session metadata (`kind: 'linear'`) so work status can show it. Clicking that work-status row opens the Linear rail when Linear is connected on desktop/web; otherwise the Linear URL. Managed Chats do not offer start-from-issue; those sessions have no project directory.
- Worktree: New Worktree can start from a Linear issue. It uses the currently active project and does not consult team-to-project mapping. GitHub issue/PR and Linear issue are exclusive on that form.
- Status comments: create-session and worktree-from-Linear post `started` after the session exists. The event hub posts `completed` on the first idle after that, and `failure` on `session.error` except `MessageAbortedError`. Failed comments must not fail session create. Comment bodies are English (they live on Linear) and are one markdown link named `OpenChamber session started: {title}` (or completed/failed). Web uses `/?session=<id>` on the current origin. Desktop uses the local loopback origin, not `openchamber-ui://`; if that origin is not http(s) the link is `openchamber://session/<id>`. Opening `/?session=` selects that session after the global session list can resolve its directory.
- Magic prompts: `linear.issue.review.visible` / `.instructions`. Do not reuse the GitHub issue-review templates for Linear.

## Notes for contributors

- Do not log tokens, codes, verifiers, or the client secret.
- Do not add Linear under Git or as a third-party plugin row.
- Actor is `user`. Do not enable Linear client-credentials tokens for this flow.
- One OAuth grant is still one Linear organization. The server stores many grants and keeps one current. Webhooks and inbound Linear issue actions are out of scope until a later change.
