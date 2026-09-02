# Hello panel

Example guest for the issue components. Add this folder in Settings → Extensions.

`panel/main.ts` is the copy-paste. `applyHostReady`, then one mount. Pass rows.

The rail uses `mountIssuePage`. A row opens `mountIssueCard`, the Linear detail. The + menu uses `mountAttachIssues`, then `host.attach` and `host.close`.

`panel/main.js` is what the iframe loads. `oc-dev` compiles `panel/main.ts` when it serves that file. A published guest ships that IIFE with `bun run --filter @openchamber/sdk bundle -- panel/main.ts panel/main.js`. The iframe cannot load ESM.

A clone of this folder needs its own `id` in `package.json`.
