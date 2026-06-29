# OpenChamber Android

This package is a lightweight Android WebView shell for official OpenChamber servers.

The app does not run or modify the OpenChamber server or OpenCode server. It packages the mobile web UI into the APK, serves it from a loopback URL inside the app, and proxies `/health`, `/auth/*`, `/api/*`, and realtime requests to the selected OpenChamber server. It stores server addresses and optional UI passwords locally, dedupes saved servers by origin, probes `/health`, and logs in through `/auth/session` when a password is available.

Build locally:

```sh
bun run --cwd packages/android build
bun run --cwd packages/android verify
```

The debug APK is written to:

```text
packages/android/android/app/build/outputs/apk/debug/app-debug.apk
```

Install to a connected device:

```sh
bun run --cwd packages/android install
```
