# Open-Source Boundary

The Electron desktop app is heading to public source; the core netmesh
(VPN) code stays closed. This file records exactly where the line is and the
mechanics that keep both sides buildable.

## What is open

- **The Electron app** — everything in this repo outside the exceptions below:
  main process, renderer, build scripts, packaging.
- **The screen-share companion** (`companion/livekit-swift-example`) — a
  lightly modified vendored LiveKit example, upstream Apache-2.0. It stays
  in-tree and open so upstream fixes keep flowing.

## What is closed

- **The netmesh companion** (`netmesh-macos/`: the OpenbaseNetmesh app,
  NetmeshHelper, NetmeshCtl, and the pinned Tailscale engine build) — the
  core VPN code. Before this repo's visibility flips to public,
  `netmesh-macos/` moves to a private repo (workspace `internal` install
  set); until then it remains in-tree and this repo remains private.

## How a public checkout builds without netmesh source

`scripts/stage-netmesh-companion.mjs` resolves the companion in priority
order:

1. a `netmesh-macos/` checkout (in-repo during the transition, or
   `OPENBASE_NETMESH_MACOS_DIR` for members with the private repo) — builds
   from source;
2. an already-staged `companion-build/OpenbaseNetmeshCompanion.app` — kept;
3. **the signed prebuilt artifact** published by every mac release
   (`<releases-bucket>/<prefix>/OpenbaseNetmeshCompanion-latest-arm64.zip`,
   uploaded by `scripts/publish-s3.mjs`) — downloaded, signature-verified,
   and staged.

Because the artifact is signed and notarization rides the outer app build,
public contributors get a bit-identical companion to what members build from
source.

## Pre-flip checklist (do these before making this repo public)

1. Extract `netmesh-macos/` to the private `openbase-netmesh-macos` repo;
   add it to the workspace `internal` install set; delete it here.
2. Ensure at least one mac release has published the companion artifact to
   both `mac/` and `mac-staging/` prefixes (the stage-script fallback needs
   it).
3. Publish as a **fresh-history mirror** — this repo's history contains the
   netmesh sources and must not ship.
4. Add the app's open-source license file at that time (deliberately not
   added while private).
5. Scrub/rotate anything flagged by a full-history secret scan even though
   history is not shipping.
