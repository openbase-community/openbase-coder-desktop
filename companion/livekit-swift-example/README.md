# Openbase Screen Share Companion

This copy is vendored under the Openbase Electron desktop app as the macOS screen-share companion. See `../README.md` for the Openbase-specific launch, IPC, token, and permission notes.

The project is trimmed to the macOS companion target used by Openbase Coder. It keeps the LiveKit room/session code and Openbase command server, but omits the upstream sample app UI, sample audio clip, iOS broadcast extension, and development workspace.

## Build

From the desktop repo:

```sh
pnpm run companion:build:mac
pnpm run companion:stage:mac
```

The staged release bundle is written to:

```text
companion-build/OpenbaseScreenShareCompanion.app
```

Open the Xcode project with:

```sh
pnpm run companion:open
```
