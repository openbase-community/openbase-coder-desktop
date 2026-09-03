# Open-Source Boundary

The Electron desktop app is public source; the core netmesh (VPN) code stays
closed. This file records exactly where the line is and the mechanics that
keep both sides buildable.

## What is open

- **The Electron app** — everything in this repo: main process, renderer,
  build scripts, packaging. Licensed AGPL-3.0-only (see `LICENSE`).
- **The screen-share companion** (`companion/livekit-swift-example`) — a
  lightly modified vendored LiveKit example, upstream Apache-2.0 (its own
  license file applies). It stays in-tree and open so upstream fixes keep
  flowing.

## What is closed

- **The netmesh companion** — the OpenbaseNetmesh app, NetmeshHelper,
  NetmeshCtl, and the pinned Tailscale engine build. It lives in the private
  `netmesh-macos` repo (workspace `internal` install set), extracted from this
  repo on 2026-09-03. A pre-push hook (`.githooks/pre-push`, installed by the
  package.json `prepare` script) blocks `netmesh-macos/` paths from ever
  re-entering this repo's history.

## How a public checkout builds without netmesh source

`scripts/stage-netmesh-companion.mjs` resolves the companion in priority
order:

1. a netmesh-macos checkout (`OPENBASE_NETMESH_MACOS_DIR`, or the workspace
   sibling `../netmesh-macos` cloned by the internal install set) — builds
   from source;
2. an already-staged `companion-build/OpenbaseNetmeshCompanion.app` — kept;
3. **the signed prebuilt artifact** published by every mac release
   (`<releases-bucket>/<prefix>/OpenbaseNetmeshCompanion-latest-arm64.zip`,
   uploaded by `scripts/publish-s3.mjs`) — downloaded, signature-verified,
   and staged.

Because the artifact is signed and notarization rides the outer app build,
public contributors get a bit-identical companion to what members build from
source.

## History

This repo's public history begins at the 2026-09-03 fresh-history mirror; the
pre-mirror history (which contained the netmesh sources) is preserved in the
private `openbase-coder-desktop-history` repo.
