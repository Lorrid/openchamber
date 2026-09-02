# Linear guest

Same chrome as ClickUp. This one lists Linear issues through the host Linear connection. No client id on the Integrations card. Connect here is the same Linear OAuth OpenChamber already uses.

Add this folder in Settings → Extensions. Then open Settings → Integrations and connect Linear, either on this card or the first-party Linear card. Disconnect on either card drops that same connection.

The iframe is `sandbox="allow-scripts"` with no `allow-same-origin`. It must not hold a token. The list still goes to Linear GraphQL through `host.request`. Issue detail uses `GET /api/linear/issues/get`, the first-party route that already asks Linear for public file URLs.

`panel/main.js` is what the iframe loads on Node. `oc-dev` compiles `panel/main.ts` when it serves that file.
