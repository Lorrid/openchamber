# Pets

A vscode-pets style guest. Cats, dogs, a snake, and a duck walk the floor of the rail panel. Click the room to throw a ball.

Add this folder in Settings → Extensions. `id` is `pets`.

`panel/main.ts` calls `connectHost()` so the room follows the host theme. The iframe loads `panel/main.js`. `oc-dev` compiles on the way out. A packaged app will not.
