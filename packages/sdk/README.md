# @openchamber/sdk

Types and a thin iframe client for OpenChamber guests. OpenChamber is the control room around OpenCode. Guests are third-party: trackers, model providers, anything that used to be welded into a release.

Author guide: [Build a guest panel](../docs/content/docs/sdk.mdx). Host methods: [Host API](../docs/content/docs/sdk/host.mdx). Drawing kit: [UI kit](../docs/content/docs/sdk/ui.mdx). Open `docs/index.html` in a browser for the same pages as one file.

This package is the language. It does not mount React into the app. A panel still runs as HTML in an iframe and talks through `connectHost()`.

`apiVersion` is the iframe envelope. `@openchamber/sdk/ui` follows this package's semver. Changing a PR footer does not bump `apiVersion`.

## Where this runs

Web and desktop load guests. VS Code and mobile do not. Those runtimes mark the catalog `unsupported`. They do not pretend you have zero extensions.

`host.provider: "linear"` reuses the first-party Linear connection. That is a bootstrap, not a pattern. Do not add a second host provider on `apiVersion` 1.

## Ship an IIFE

The iframe cannot load ESM. Packaged OpenChamber and `openchamber serve` will not compile TypeScript. Build `panel/main.js` yourself:

```bash
bun run --filter @openchamber/sdk bundle -- panel/main.ts panel/main.js
```

Same flags the host uses in `oc-dev`: `format: 'iife'`, `target: 'browser'`, `minify: true`. Point the HTML at that file.

## First hole: a rail panel

In `package.json`:

```json
{
  "name": "@acme/hello-panel",
  "openchamber": {
    "apiVersion": 1,
    "contributes": {
      "panel": {
        "id": "acme-hello",
        "name": "Hello",
        "icon": "window",
        "entry": "panel/index.html"
      },
      "attach": "dialog",
      "integration": {
        "name": "Acme",
        "description": "Tasks from Acme",
        "oauth": {
          "authorizeUrl": "https://acme.example/oauth/authorize",
          "tokenUrl": "https://acme.example/oauth/token",
          "apiOrigin": "https://api.acme.example"
        },
        "settings": [{ "id": "list-id", "label": "List ID" }]
      }
    }
  }
}
```

`id` is kebab-case. `icon` is a Remixicon name in the same kebab-case the rail uses: `RiWindowLine` → `window`. `icon.svg` and other package files fail parse. `entry` is a path inside the package. `../` and absolute paths fail parse.

`attach: true` or `"panel"` adds a + menu row that opens the rail. `"attach": "dialog"` opens a host window with the same iframe. `ready.surface` is `panel` or `dialog` so the guest can draw a rail form in one and an attach picker in the other. Pets stays off that menu because it does not set attach. VS Code and mobile have no guest rail. That is the 1.0 contract, not a gap in the docs.

`integration` is optional. The host draws the Settings → Integrations card. OAuth guests paste a client id there. Token guests paste an API token. `host: { "provider": "linear" }` reuses the OpenChamber Linear connection and never asks for a client id. The guest never sees the token. `host.request` is a GET or write on that `apiOrigin` only. Host Linear is `https://api.linear.app` only.

In the panel:

```ts
import { connectHost, HostRequestError } from '@openchamber/sdk';

const host = connectHost();

host.onReady((ctx) => {
  document.body.dataset.theme = ctx.theme.mode;
  document.body.dataset.surface = ctx.surface;
});

host.onDirectory((directory) => {
  document.querySelector('#dir')!.textContent = directory ?? '';
});

host.onSession((session) => {
  document.querySelector('#session')!.textContent = session?.title ?? '';
});

host.onConnection((connection) => {
  document.querySelector('#account')!.textContent = connection.account;
});

await host.oauthStart();
try {
  const user = await host.request({ method: 'GET', path: '/api/v2/user' });
} catch (error) {
  if (error instanceof HostRequestError && error.code === 'DISCONNECTED') {
    await host.oauthStart();
  }
}

await host.toast({ kind: 'info', message: 'Hello' });
await host.writeClipboard('/repo');
await host.compose({ text: 'Ask about the latest diff' });
await host.attach({
  providerId: 'acme-hello',
  id: 'TICKET-1',
  title: 'Login is broken',
  url: 'https://example.com/TICKET-1',
});
await host.attach({
  providerId: 'acme-hello',
  id: '!12',
  title: 'Fix login',
  url: 'https://example.com/merge_requests/12',
  kind: 'pull',
  author: 'ada',
  branches: { head: 'feature', base: 'main' },
  text: 'Optional diff or notes',
});
await host.startSession({
  providerId: 'acme-hello',
  id: '!12',
  title: 'Fix login',
  url: 'https://example.com/merge_requests/12',
  kind: 'pull',
  author: 'ada',
  branches: { head: 'feature', base: 'main' },
  worktree: true,
  text: 'Optional diff or notes',
});
await host.close();
```

The UI kit is DOM plus host tokens. Import `@openchamber/sdk/ui` and call `applyHostReady` from `onReady` first. `mountButton`, `mountTextField`, and `mountEmpty` are the connect chrome. They share the same tokens as the issue page.

`mountIssuePage` is the tracker list. Compact filters, search as an icon, identifier + title rows. Linear looks like this on the rail. Jira and ClickUp pass the same rows.

```ts
import { applyHostReady, mountIssuePage } from '@openchamber/sdk/ui';

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  mountIssuePage(document.querySelector('#root')!, {
    items: tasks,
    filters,
    onSelect: (item) => {
      void host.attach({
        providerId: 'acme-hello',
        id: item.id,
        title: item.title,
        url: item.url ?? '',
      });
    },
  });
});
```

`mountIssueCard` is the issue after a row click. Back, status picker, metadata, description, comments, and a footer button. Description and comments stay plain text. The guest disposes the list and mounts the card.

`mountPullRequest` is the host Pull Request window. Pass `mode: 'view'` with a record, checks, and comments, or `mode: 'create'` with a submit handler. Tabs are Overview, Checks, and Comments. Footer callbacks are attach, new session, new worktree, ready, and merge. The kit paints. The guest talks to GitLab or whoever through `host.request`. Git stays on the host.

`mountAttachIssues` is the + menu picker. Search stays open. Skip `filters` unless the picker needs them. Pass `badge` and `subtitle` on a row when the GitHub picker would show a repo or `head → base`. `hasMore` / `onMore` loads the next remote page. `toggle` is one checkbox. The guest puts the meaning in `attach.text`. On select, call `host.attach` and `host.close`. `kind: 'pull'` is a PR chip, not an issue chip. `session` is a second checkbox, like Create in worktree. When it is checked, call `host.startSession({ worktree: true })` instead of `attach`. `action` is a page button.

`value` on a filter is the starting choice. After that the component keeps the user's picks when you `update` with a new `items` list.

`slot` places a filter. `start` grows on the left and keeps its label, like Linear status. `end` packs to the right and turns into an icon when the panel is under 520px. Skip `slot` and the first filter is `start`, the rest are `end`.

`compose` puts text in the chat box. It does not send. Default mode is `append`, so a draft the user already typed stays. Pass `replace` when you mean to overwrite.

`attach` puts a chip on the composer, the same place GitHub and Linear land. Exclusive with those. `id` is the guest's identifier, not a GitHub number. `close` dismisses the attach window.

`startSession` creates a new session and writes that same snapshot on it. `worktree: true` asks the host to make a worktree first, the way New Worktree does for a GitHub issue. The guest never talks to git. A missing project, a failed worktree, or a failed session create is a host error. VS Code and mobile do not mount guests, so they do not run this.

The host parses the same block with `parseManifest`. An unknown `apiVersion` is a refusal, not a guess.

## Slot map

What exists in code today:

- `contributes.panel`
- `contributes.attach` — `true` / `"panel"` opens the rail; `"dialog"` opens a host window around the same iframe
- `contributes.integration` — host Integrations card, OAuth URLs, optional settings fields
- `connectHost`: theme, locale, directory, session `{ id, title }`, connection, settings, toast, `openUrl`, `openSurface`, `writeClipboard`, `compose`, `attach` (`kind` issue or pull), `startSession` (same fields plus `worktree`), `close`, `oauthStart`, `oauthDisconnect`, `request`
- Host hole on web and desktop: `GET /api/guests`, Settings → Extensions (folder path, stored per OpenChamber instance), Settings → Integrations, a rail iframe, the composer + menu, and the attach window (`examples/hello-panel`, `examples/clickup`, `examples/gitlab`). VS Code and mobile mark the catalog unsupported. Ship a classic IIFE with the bundle command above. The packaged app does not compile TypeScript.
- `HostRequestError.code`: `HOST_UNAVAILABLE`, `HOST_TIMEOUT` (20s), `HOST_REJECTED`, `DISCONNECTED`, `BAD_PATH`, `NO_INTEGRATION`. An unknown wire code becomes `HOST_REJECTED`.
- `@openchamber/sdk/ui`: `applyHostReady`, `mountIssuePage`, `mountIssueCard`, `mountAttachIssues`, `mountPullRequest`, `mountButton`, `mountTextField`, `mountEmpty`. The guest passes rows. A row may carry `badge` and `subtitle`. The picker can `hasMore`, show one `toggle`, a `session` checkbox, and an `action`. The host does not search.

Frozen on `apiVersion` 1. No new RPC and no second `host.provider` until this set has lived with guests that are not in `examples/`. Named, not typed yet. No slot means no hole in the host. Do not go around it through `RuntimeAPIs`.

- `issues` — `search` / `get` still named on the host. The chip is `attach`. The guest draws the list with the UI kit.
- `sessionLink` on an existing session. `startSession` already writes the snapshot on a new one.
- `sessionLifecycle` — started / completed / failure
- A public OAuth broker. Redirect is `{serverOrigin}/api/guests/{id}/oauth/callback`
- commands, shortcuts
- Git remote / PR (not the same as `issues`)
- Magic prompts, skills catalog source, URL scheme

GitHub pull requests stay off `issues`. A tracker that is not GitHub should not invent a `number`.

## What this package will not grow into

Files, the terminal, raw git, permissions, pairing. Linear and GitHub HTTP clients. The host's React tree.
