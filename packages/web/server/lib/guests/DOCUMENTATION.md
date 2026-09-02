# Guest panels

## Purpose

OpenChamber-owned install and static serve for iframe guests. This is not the OpenCode plugin manager (`plugin-routes.js` / Settings → Plugins).

## Routes

- `GET /api/guests` — installed guests. `attach: true` is on the row when the manifest set it. `integration` is the public slice only: name, description, `auth`, setting field defs. OAuth URLs and token origins stay on the server. Failure is 500, not an empty list.
- `GET /api/guests/:id/oauth/status` — `{ connected, account, hasClient, settings, redirectUri }`. No secrets. Host Linear merges first-party Linear status. `redirectUri` is empty unless `auth` is `oauth`.
- `PUT /api/guests/:id/oauth/client` — client id and optional secret from the Integrations form. OAuth guests only.
- `PUT /api/guests/:id/token` — pasted API token. Token guests only. The host probes the declared account path. The token never goes to the iframe.
- `PUT /api/guests/:id/settings` — declared keys only.
- `POST /api/guests/:id/oauth/start` — PKCE S256 for OAuth guests. Host Linear starts the first-party Linear authorize URL. Token guests get `NO_INTEGRATION`.
- `GET /api/guests/:id/oauth/callback` — public HTML page. The provider redirects here with no UI bearer. State and verifier stay on the server. If the provider omits `state`, the one pending exchange for that guest is used. Host Linear uses the first-party Linear callback, not this URL.
- `DELETE /api/guests/:id/oauth` — drops tokens for that guest. Client and settings stay. Host Linear disconnects the first-party Linear workspace.
- `POST /api/guests/:id/request` — authenticated UI session. Attaches Authorization. Path must stay on that guest's `apiOrigin`. Token guests send the raw token. Host Linear sends the Linear bearer to `https://api.linear.app` only. Linear issue file URLs stay on `GET /api/linear/issues/get`. The guest proxy does not add Linear headers.
- `POST /api/guests` — `{ path }` or `{ url }`, exactly one. `path` is an absolute folder or a local `.zip`. `url` is https git or an https `.zip`. Folder persist is the realpath in this instance's `{openchamberDataDir}/extensions.json`, 201. Zip and git copy into `{openchamberDataDir}/guests/{id}`. Missing, invalid, or relative path is 400 `invalid-path`. A bad URL is 400 `invalid-url`. Clone fail is 400 `clone-failed`. Extract fail is 400 `extract-failed`. A panel whose HTML loads a relative `.js` that is not on disk is 400 `missing-build`. Duplicate id or folder is 409. Two OpenChamber processes with different `OPENCHAMBER_DATA_DIR` do not share this list.
- `DELETE /api/guests/:id` — drops the store row. Path-install does not delete the user's folder. Zip and git copies under `{openchamberDataDir}/guests/` are deleted. Unknown id is 404.
- `GET /api/guests/:id/{*filePath}` — a file inside that guest's package root. Unknown id, escape, missing file, or unknown type is 404. Guest HTML gets the request's `oc_url_token` copied onto relative `script` / `link` / `img` URLs so the iframe can load its own files.

## Install

Guests do not ship inside the app. Add a folder, a local `.zip`, or an https git / zip URL from Settings → Extensions. Connect on Settings → Integrations. A guest must ship `panel/main.js` as a classic IIFE from `bun run --filter @openchamber/sdk bundle -- panel/main.ts panel/main.js`. Packaged Electron and `openchamber serve` run the server on Node and will not compile TypeScript. `oc-dev` on Bun still compiles `panel/main.ts` when it serves `panel/main.js`, including SDK files the panel imports. The iframe has no `allow-same-origin`, so ESM imports do not run.

OAuth and pasted tokens live in `{openchamberDataDir}/guest-auth.json`. Host Linear tokens stay in `linear-auth.json`. Writes are atomic and `0o600`. The file is per OpenChamber instance, same as `extensions.json`. Web and desktop share it. VS Code and mobile set the guest catalog to `unsupported`. That is not an empty ready list. Those cards stay hidden.

A missing folder is omitted from the list. Other guests stay. A corrupt `extensions.json` is 500, not an empty catalog. A missing or blank `guest-auth.json` is an empty store. Corrupt JSON there is 500, not a disconnected card. This is not Settings → Plugins.

## Invariants

- Paths stay inside the package root (`realpath`). `..`, absolute paths, and URLs do not serve.
- Only an allowlisted content type is served.
- Host and guest speak `@openchamber/sdk`. Do not copy those types into `packages/ui`.
- `contributes.attach` is copied as `"panel"` or `"dialog"`. The composer + menu and New Worktree read that field. Omitted guests stay off those menus.
- `request` never leaves the declared `apiOrigin`. A 401 refreshes once. If that fails, tokens for that guest are dropped. Host Linear does not drop Linear auth on a failed GraphQL query.
- The OAuth callback skips UI auth. Everything else under `/api/guests` stays behind the usual session.
