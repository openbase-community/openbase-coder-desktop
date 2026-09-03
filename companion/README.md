# Openbase LiveKit Swift Companion

This folder vendors the LiveKit Swift example as a side companion macOS app for the Electron desktop app.

The companion is not a replacement for the Electron app. Electron launches the built macOS app bundle and sends local loopback IPC commands to start or stop full-display screen sharing. The Swift app joins the same LiveKit room as a separate participant using the standard identity `openbase-screen-share-companion`.

## Open in Xcode

From the desktop repo:

```sh
npm run companion:open
```

Select the macOS scheme, configure local signing if Xcode asks for it, then build the app. The Electron bridge looks for the Debug app bundle at:

```text
companion/livekit-swift-example/.derivedData/Build/Products/Debug/OpenbaseScreenShareCompanion.app
```

The bridge also checks the upstream `LiveKitExample.app` name as a fallback.

You can build to that location with:

```sh
npm run companion:build:mac
```

If you build somewhere else, launch Electron with:

```sh
OPENBASE_LIVEKIT_COMPANION_APP_PATH=/path/to/LiveKitExample.app npm run dev
```

## Release Packaging

The macOS release command builds the companion in Release configuration, stages it at:

```text
companion-build/OpenbaseScreenShareCompanion.app
```

Electron Builder copies that staged app into the packaged app's resources, and the Electron bridge checks packaged resources before falling back to the local Debug build paths.

## Electron Integration Hook

The desktop shell exposes a visible screen-share toggle, but the shared React app must provide the active LiveKit room URL and a freshly minted token for the companion participant.

Use either interface from the renderer:

```ts
window.__OPENBASE_LIVEKIT_COMPANION_SESSION__?.setSession({
  roomUrl: "wss://...",
  companionToken: "<token for openbase-screen-share-companion>",
  companionTokenExpiresAt: "2026-05-23T12:00:00Z",
});
```

or dispatch:

```ts
window.dispatchEvent(
  new CustomEvent("openbase:livekit-companion-session", {
    detail: {
      roomUrl: "wss://...",
      companionToken: "<token for openbase-screen-share-companion>",
      companionTokenExpiresAt: "2026-05-23T12:00:00Z",
    },
  }),
);
```

The token minting endpoint is intentionally not invented in this repo. The call site that already knows the active LiveKit room/session should request a companion token from the Openbase backend using identity `openbase-screen-share-companion`, then pass it to one of the hooks above.

## macOS Permissions

macOS Screen Recording permission applies to the Swift companion app bundle, not the Electron button. The first share attempt may fail or trigger a system prompt. If needed, grant Screen Recording permission to the companion app in System Settings and restart the companion app.

## Remote Control

Remote control is a first-class mode on top of the same LiveKit room used for screen sharing. The iOS screen-share UI publishes explicit `openbase.remote_control.*` data messages only after the user enables Remote in the full-screen screen-share view. The companion records the enabling participant identity and ignores mouse or keyboard input from other participants until Remote is disabled.

The MVP input contract is intentionally small:

- `openbase.remote_control.set_enabled` with `enabled: true|false`
- `openbase.remote_control.input` with `action: move|click|scroll|type|keypress`

Mouse movement comes from the dedicated iOS trackpad surface, not from direct pointer interaction with the video. Keyboard support covers printable typing, Enter, Escape, Tab, Backspace, arrows, and common modifier combinations such as Command-A/C/V. The companion only accepts remote-control input while its screen share is active, disables remote control when the share stops, and refuses human remote control while OpenAI computer-use is running.

## IPC

Electron starts the app bundle with `--openbase-ipc-port` and `--openbase-ipc-secret`. The `secret` name is legacy protocol wording; the value is a per-run localhost IPC capability token, not a long-lived secret or API key. The Swift app listens on loopback TCP and accepts:

- `GET /status`
- `POST /screen-share/start`
- `POST /screen-share/stop`

The IPC capability token is sent as `X-Openbase-Companion-Secret` for compatibility with the existing companion protocol. Logs include request/response state and token presence/fingerprint only; full LiveKit tokens are not logged.
