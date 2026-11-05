# CupNet mini

A standalone desktop app for web-traffic analysis: a local MITM proxy backed by a
native Go **AzureTLS** worker that speaks the real Google Chrome TLS/HTTP
fingerprint, plus a local control UI (request log, rules, inspector, intruder,
site map, DNS, notes, sessions). Point any browser at the proxy and inspect,
edit, and replay its traffic.

The core — the proxy and the worker — is plain **Node + Go, no Electron**. Electron
is only the desktop shell that gives the app its own window and icon; it spawns the
unchanged backend and loads the control UI. The same backend also runs as a CLI and
headless on a server.

## Install

Grab the build for your OS from the [Releases](../../releases) page:

| OS | File |
|----|------|
| macOS (Apple Silicon / Intel) | `CupNet mini-<ver>-arm64.dmg` / `-x64.dmg` |
| Windows | `CupNet mini Setup <ver>.exe` (installer) or the `portable` `.exe` |
| Linux | `CupNet mini-<ver>.AppImage` or the `.tar.gz` |

Builds are **unsigned**, so the OS will warn on first launch:

- **macOS:** right-click the app → *Open*, or
  `xattr -dr com.apple.quarantine "/Applications/CupNet mini.app"`.
- **Windows:** *More info* → *Run anyway* on the SmartScreen prompt.
- **Linux:** `chmod +x` the AppImage.

## Use

1. Launch CupNet mini — the control UI opens in its own window.
2. Point a browser at the proxy: **HTTP and HTTPS proxy = `127.0.0.1:8877`**
   (or launch a throwaway Chrome: `--proxy-server=127.0.0.1:8877`).
3. Trust the CupNet CA once so HTTPS pages verify — the UI shows the certificate
   and the per-OS install command (macOS Keychain, Windows cert store,
   `update-ca-certificates`, or Firefox's import).

Upstream proxies, TLS pass-through, CORS, and ports are all configured live in the
UI — nothing is baked into the build.

Data (CA, rules, sessions) lives under the OS app-data dir
(`~/Library/Application Support/CupNet mini/data` on macOS, `%APPDATA%\CupNet mini\data`
on Windows, `~/.config/CupNet mini/data` on Linux). Set `CUPNET_MINI_DIR` to override.

## Build from source

Requires **Node ≥ 20** and **Go ≥ 1.24**.

```bash
npm install
npm run build:go      # cross-compiles the AzureTLS workers into azuretls-go/bin
npm start             # run the app from source (electron .)
```

Package installers for the current OS:

```bash
npm run dist          # current OS
npm run dist:mac      # or :linux / :win
```

Output lands in `dist/`. The `afterPack` hook keeps only the worker binary matching
each build. Building one OS's installers is only fully supported on that OS
(especially Windows and Linux AppImage), which is what the CI workflow is for.

## Releases (all platforms)

`.github/workflows/release.yml` builds macOS (x64 + arm64), Windows (x64), and Linux
(x64) each on its own GitHub-hosted runner and attaches the installers to the
Release. Push a tag to cut one:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Or trigger the workflow by hand (*Actions → build → Run workflow*) to get artifacts
without tagging.

## Layout

```
desktop/          Electron shell (window + icon; spawns the backend, loads the UI)
mini/             the backend: MITM proxy, control UI, inspector, stores
azuretls-go/      native Go AzureTLS upstream worker (sources + build.sh)
*.js              shared backend modules (interceptor, mitm, utils, …)
icons/            app icons (.icns / .ico / .png)
```

The backend sources are a faithful subset of the CupNet monorepo in the same relative
layout, so their `require()` paths work unchanged.

## License

ISC.
