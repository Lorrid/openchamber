# ClickUp guest

Same chrome as Hello. This one talks to ClickUp through the host.

Add this folder in Settings → Extensions. Then open Settings → Integrations, paste a ClickUp personal API token and a list id, and save. ClickUp Settings → Apps has the token.

The iframe is `sandbox="allow-scripts"` with no `allow-same-origin`. It must not hold a token. `host.request` is a path on `https://api.clickup.com`. The host attaches `Authorization`.

`panel/main.js` is what the iframe loads on Node. `oc-dev` compiles `panel/main.ts` when it serves that file.
