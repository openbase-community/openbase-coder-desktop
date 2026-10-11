"""Live probe: every way a viewer leaves must end the desktop screen share.

Run on a macOS desktop backend with the Openbase app running, using the
Openbase runtime's Python (it ships the LiveKit SDK):

    ~/.openbase/packages/standalone/current/python/bin/python \
        scripts/screen-share-stop-probe.py [path ...]

Each path starts a share into a private test room through the desktop app's
control server, confirms video frames arrive, makes the viewer leave in one
way, and then requires the companion to stop capturing: its participant
leaves the room and its state returns to "off". Paths:

  viewer-stop   viewer sends openbase.screen_share.stop (phone Stop button)
  api-stop      local API stop (POST /livekit-companion/stop-screen-share)
  hangup        viewer disconnects cleanly (call ended on the phone)
  dropped       viewer process is killed without leaving (lost connection)
  room-closed   server deletes the room (call torn down server-side)

Exit status is non-zero if any path leaves the companion sharing.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from livekit import api, rtc

COMPANION_IDENTITY = "openbase-screen-share-companion"
VIEWERLESS_GRACE_SECONDS = 10
# LiveKit notices a vanished client after its ping timeout (~15-20 s).
DROPPED_DEADLINE_SECONDS = 60


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (Path.home() / ".openbase" / ".env").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


ENV = load_env()
URL = ENV.get("LIVEKIT_URL", "ws://localhost:7880")
API_URL = URL.replace("ws://", "http://").replace("wss://", "https://")


def token(room: str, identity: str, *, publish: bool) -> str:
    return (
        api.AccessToken(ENV["LIVEKIT_CLIENT_API_KEY"], ENV["LIVEKIT_CLIENT_API_SECRET"])
        .with_identity(identity)
        .with_name(identity)
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=publish,
                can_subscribe=not publish,
                can_publish_data=True,
            )
        )
        .to_jwt()
    )


def control(path: str, body: dict | None = None, method: str = "POST") -> dict:
    ctl = json.loads((Path.home() / ".openbase" / "desktop-control.json").read_text())
    request = urllib.request.Request(
        f"http://127.0.0.1:{ctl['port']}{path}",
        method=method,
        data=json.dumps(body or {}).encode() if method == "POST" else None,
        headers={"X-Openbase-Desktop-Secret": ctl["secret"], "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        return {"httpStatus": exc.code, **json.loads(exc.read() or b"{}")}


async def companion_in_room(room: str) -> bool:
    lkapi = api.LiveKitAPI(API_URL, ENV["LIVEKIT_API_KEY"], ENV["LIVEKIT_API_SECRET"])
    try:
        response = await lkapi.room.list_participants(api.ListParticipantsRequest(room=room))
        return any(p.identity == COMPANION_IDENTITY for p in response.participants)
    except Exception:
        return False
    finally:
        await lkapi.aclose()


async def wait_until_stopped(room: str, deadline_seconds: float) -> float | None:
    start = time.monotonic()
    while time.monotonic() - start < deadline_seconds:
        state = (control("/status", method="GET").get("companion") or {}).get("state")
        if state in ("off", None) and not await companion_in_room(room):
            return time.monotonic() - start
        await asyncio.sleep(1)
    return None


async def start_share(room: str, viewer: rtc.Room) -> None:
    frames = asyncio.Event()

    @viewer.on("track_subscribed")
    def _on_track(track, _publication, participant):
        if track.kind == rtc.TrackKind.KIND_VIDEO:
            async def pump():
                async for _ in rtc.VideoStream(track):
                    frames.set()
                    break
            asyncio.ensure_future(pump())

    await viewer.connect(URL, token(room, "probe-viewer", publish=False))
    result = control(
        "/livekit-companion/start-screen-share",
        {"roomUrl": URL, "companionToken": token(room, COMPANION_IDENTITY, publish=True)},
    )
    if result.get("ok") is False or result.get("httpStatus"):
        raise RuntimeError(f"start failed: {result}")
    await asyncio.wait_for(frames.wait(), 20)


async def run_path(path: str) -> bool:
    room = f"ssc-stop-{path}-{int(time.time())}"
    deadline = VIEWERLESS_GRACE_SECONDS + 10
    if path == "dropped":
        # The viewer lives in a child process we SIGKILL, so no leave is sent.
        child = subprocess.Popen([sys.executable, __file__, "--viewer-child", room])
        await asyncio.sleep(25)
        os.kill(child.pid, signal.SIGKILL)
        child.wait()
        elapsed = await wait_until_stopped(room, DROPPED_DEADLINE_SECONDS)
    else:
        viewer = rtc.Room()
        await start_share(room, viewer)
        if path == "viewer-stop":
            await viewer.local_participant.publish_data(
                json.dumps({"type": "openbase.screen_share.stop"}).encode(),
                reliable=True,
                destination_identities=[COMPANION_IDENTITY],
            )
            deadline = 8
        elif path == "api-stop":
            control("/livekit-companion/stop-screen-share")
            deadline = 8
        elif path == "hangup":
            await viewer.disconnect()
        elif path == "room-closed":
            lkapi = api.LiveKitAPI(API_URL, ENV["LIVEKIT_API_KEY"], ENV["LIVEKIT_API_SECRET"])
            await lkapi.room.delete_room(api.DeleteRoomRequest(room=room))
            await lkapi.aclose()
            deadline = 8
        elapsed = await wait_until_stopped(room, deadline)
        await viewer.disconnect()
    ok = elapsed is not None
    print(f"{path:12} {'PASS' if ok else 'FAIL'}" + (f" stopped after {elapsed:.1f}s" if ok else " still sharing"), flush=True)
    if not ok:
        control("/livekit-companion/stop-screen-share")
    return ok


async def viewer_child(room: str) -> None:
    viewer = rtc.Room()
    await start_share(room, viewer)
    print("viewer-child: receiving video", flush=True)
    await asyncio.sleep(3600)


async def main(argv: list[str]) -> int:
    if argv[:1] == ["--viewer-child"]:
        await viewer_child(argv[1])
        return 0
    paths = argv or ["viewer-stop", "api-stop", "hangup", "room-closed", "dropped"]
    results = [await run_path(path) for path in paths]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
