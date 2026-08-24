# Linear Module Documentation

## Purpose

This module owns Linear OAuth, issue lookup, Linear-team-to-project mapping, and session status comments on Linear issues. The credential lives on the OpenChamber server, so web, desktop, and a phone paired to that host share one login. The chat picker lists issues and attaches them to a message. New Worktree can also start from a Linear issue in the currently active project. A session started from a Linear issue posts started/completed/failure comments, each with an OpenChamber session link.

VS Code omits Linear (`RuntimeAPIs.linear` is optional). Hide Linear UI when the API is missing.

## Entrypoints and structure

- `packages/web/server/lib/linear/index.js`: public server entrypoint. `routes.js` loads it lazily with `await import('./index.js')`.
- `packages/web/server/lib/linear/routes.js`: Express registration for the public callback, `/api/linear/auth/*`, `/api/linear/issues/*`, `/api/linear/mapping`, and `/api/linear/session-status`.
- `packages/web/server/lib/linear/auth.js`: auth file, client id, scopes, redirect URI.
- `packages/web/server/lib/linear/oauth.js`: authorization-code + PKCE S256, refresh, revoke.
- `packages/web/server/lib/linear/client.js`: GraphQL helper, viewer/organization lookup, and access-token refresh.
- `packages/web/server/lib/linear/issues.js`: list/search/get issues and `commentCreate`. Parses identifiers and Linear URLs.
- `packages/web/server/lib/linear/teams.js`: list Linear teams for mapping UI.
- `packages/web/server/lib/linear/mapping.js`: persist default and per-team OpenChamber project paths. Separate from the auth file so disconnect does not wipe maps.
- `packages/web/server/lib/linear/status.js`: persist per-session started/completed/failure flags and post the matching Linear comment with an open-session URL.
- `packages/web/server/lib/linear/status-runtime.js`: on the OpenCode event hub, first `session.status` idle after started posts completed once; `session.error` (except abort) posts failure once.
- `packages/web/src/api/linear.ts`: web client wrapper. Electron and hosted/Capacitor mobile reuse it. VS Code omits `linear`.

## Public routes

- `GET /linear/oauth/callback`: public. Linear redirects the system browser here. Safe without a UI session because it only completes a `code` whose `state` matches a pending PKCE verifier created by an authenticated start call.
- `GET /api/linear/auth/status`: connected flag, user, organization, scope. Never returns tokens.
- `POST /api/linear/auth/start`: returns `{ authorizationUrl, expiresIn, scope }`. Body may include `origin: "desktop"` so the callback page can raise the desktop window.
- `DELETE /api/linear/auth`: revokes the refresh token when present, then deletes the local auth file. Mapping is kept.
- `GET /api/linear/issues/list?query=&cursor=`: open issues from the connected workspace, or a search. An identifier or Linear URL returns that issue even if it is completed. Never returns tokens.
- `GET /api/linear/issues/get?id=`: one issue by UUID or identifier, including description, comments, and team.
- `GET /api/linear/mapping`: stored default project plus live Linear teams with their mapped paths. Missing file is empty mapping. Malformed file is 500, not empty success. Disconnected is `{ connected: false }` with HTTP 200.
- `PUT /api/linear/mapping`: replace default project and per-team paths. Body `{ defaultProjectPath, teamProjectPaths }`. Failed write does not touch tokens. Disconnected is `{ connected: false }` and does not save.
- `POST /api/linear/session-status`: post a started/completed/failure comment on the linked Linear issue. Body `{ kind, sessionId, issueIdentifier?, sessionOrigin?, sessionTitle? }`. `started` requires `issueIdentifier`. `completed` and `failure` reuse the stored issue, open URL, and session title from `started`. Each kind posts at most once per session. `sessionOrigin` must be `http` or `https` with no path, or `openchamber:` for a desktop `openchamber://session/<id>` link; otherwise the comment uses `http://127.0.0.1:<listen-port>`. Comment bodies are one markdown link: `[OpenChamber session started: Title](url)` so Linear keeps the `?session=` query. Missing title falls back to the session id. Disconnected is `{ connected: false }` with HTTP 200. Invalid body is 400.

`POST /api/linear/auth/start`, `PUT /api/linear/mapping`, and `POST /api/linear/session-status` parse JSON on the route (`16kb`). They are not on the `/api` 50mb allowlist.

Disconnected list/get/mapping/session-status return `{ connected: false }` with HTTP 200 so the picker can show its empty state. Missing `id` on get is 400.

## Auth storage and config

- Auth storage: `~/.config/openchamber/linear-auth.json` (or `$OPENCHAMBER_DATA_DIR/linear-auth.json`)
- Mapping storage: `~/.config/openchamber/linear-mapping.json` (same data dir). Writes are atomic and file mode is `0o600`.
- Session status storage: `~/.config/openchamber/linear-session-status.json` (same data dir). Writes are atomic and file mode is `0o600`. Dedupes started/completed/failure per OpenChamber session id.
- Writes are atomic and file mode is `0o600`.
- Client ID: `OPENCHAMBER_LINEAR_CLIENT_ID` -> `settings.json` `linearClientId` -> baked-in public default.
- Client secret: `OPENCHAMBER_LINEAR_CLIENT_SECRET` -> `settings.json` `linearClientSecret`. Optional with PKCE. Do not commit a secret.
- Scopes: `OPENCHAMBER_LINEAR_SCOPES` -> `settings.json` `linearScopes` -> `read,write,comments:create`.
- Redirect URI: `OPENCHAMBER_LINEAR_REDIRECT_URI` -> `settings.json` `linearRedirectUri` -> `http://127.0.0.1:<listen-port>/linear/oauth/callback`.

Linear requires an exact callback match. Production listens on 3000; `bun oc-dev` listens on 3001 unless `OPENCHAMBER_PORT` is set. Register every listen origin you actually use.

## OAuth contract

- Authorization code + PKCE S256. Linear has no device flow.
- Access tokens expire in 24 hours. Refresh tokens rotate; persist the new refresh token from every successful refresh. Concurrent refreshes share one in-flight promise.
- `invalid_grant` / 401 on refresh clears the local auth file so status becomes disconnected instead of looping a dead token.
- A GraphQL 401 after a valid-looking token also clears auth. A network failure while a token is stored does not: status stays connected with the last known user.

## Project mapping

OpenChamber has projects (directories), not accounts or organizations. Mapping is how create-session picks a directory:

1. If the issue's Linear team has a project path, use that.
2. Otherwise use the default project path.
3. If neither is set, the picker tells the user to map the team in Settings → Integrations. It does not fall back to the currently active project.

## Shared UI

- `RuntimeAPIs.linear` is optional. Hide Linear settings and the chat picker when it is missing (VS Code).
- Store: `packages/ui/src/stores/useLinearAuthStore.ts`. App start refreshes it from `App.tsx` and `MobileApp.tsx`, not `VSCodeApp`.
- Settings: first-party section on the Integrations page. Connect opens the authorization URL and polls status. When connected, map a default project and optional per-team projects.
- Chat: composer attach menu "Link Linear Issue" attaches body and comments as `linear-issue` context on the next send. Exclusive with a linked GitHub issue or PR. The attached issue is stored on session metadata (`kind: 'linear'`) so work status can show it.
- Chat: a Linear button next to New Chat (and next to mobile New Chat) opens the create-session picker. In the sidebar it uses the same hover/focus reveal as New Chat. Hide it when `RuntimeAPIs.linear` is missing or Linear is not connected.
- Worktree: New Worktree can start from a Linear issue. It uses the currently active project and does not consult team-to-project mapping. GitHub issue/PR and Linear issue are exclusive on that form.
- Status comments: create-session and worktree-from-Linear post `started` after the session exists. The event hub posts `completed` on the first idle after that, and `failure` on `session.error` except `MessageAbortedError`. Failed comments must not fail session create. Comment bodies are English (they live on Linear) and are one markdown link named `OpenChamber session started: {title}` (or completed/failed). Web uses `/?session=<id>` on the current origin. Desktop uses the local loopback origin, not `openchamber-ui://`; if that origin is not http(s) the link is `openchamber://session/<id>`. Opening `/?session=` selects that session after the global session list can resolve its directory.
- Magic prompts: `linear.issue.review.visible` / `.instructions`. Do not reuse the GitHub issue-review templates for Linear.

## Notes for contributors

- Do not log tokens, codes, verifiers, or the client secret.
- Do not add Linear under Git or as a third-party plugin row.
- Actor is `user`. Do not enable Linear client-credentials tokens for this flow.
- One OAuth grant is one Linear workspace. Webhooks and inbound Linear issue actions are out of scope until a later change.
