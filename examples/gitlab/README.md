# GitLab guest

Same chrome as ClickUp. This one lists issues and merge requests from a gitlab.com project. A merge request opens the pull-request window: overview, checks, comments, attach, new session, or new worktree. The attach window can still pin a chip, or check Create in worktree and pick a row. A merge request attach is a pull chip, with source → target, and an optional include-diff box that puts the MR changes in `text`.

Add this folder in Settings → Extensions. Then open Settings → Integrations, paste a GitLab application client id and secret, copy the redirect URL into that app, and connect. The project path is a setting on that same card, like `group/project`.

Create the app at gitlab.com under Preferences → Applications. Confidential. Scope `api`. Redirect URL is the one the Integrations card shows.

This sample is gitlab.com only. `apiOrigin` is fixed in the manifest, so a self-hosted GitLab needs its own package.

The iframe is `sandbox="allow-scripts"` with no `allow-same-origin`. It must not hold a token. `host.request` is a path on `https://gitlab.com`. The host attaches `Authorization`.

`panel/main.js` is what the iframe loads on Node. `oc-dev` compiles `panel/main.ts` when it serves that file.
