# ChromeRemote

ChromeRemote is a Chrome extension that controls the active Netflix HTML5 player from a compact desktop popup. Milestone 2 adds temporary QR pairing for a browser-based phone remote.

## Architecture

Netflix playback remains controlled by the existing extension path:

```text
Netflix tab -> content script -> existing player/Netflix-safe adapter
```

Phone remote commands are relayed through the background service worker:

```text
Phone web remote -> Railway Node service -> MV3 background worker -> paired Netflix tab
```

The same Node service serves `GET /health`, `POST /api/sessions`, `DELETE /api/sessions/:sessionId`, WebSocket upgrades at `/ws`, and the built mobile remote at `/r/:sessionId`. The popup does not own the WebSocket. The background worker owns session state, reconnect state, the WebSocket, controller connection state, and `pairedTabId`, so the phone can keep controlling Netflix after the popup closes.

## Extension Production Configuration

Local extension builds use:

```text
VITE_REMOTE_HTTP_ORIGIN=http://localhost:8787
VITE_REMOTE_WS_ORIGIN=ws://localhost:8787
```

If `VITE_REMOTE_WS_ORIGIN` is omitted, it is derived from `VITE_REMOTE_HTTP_ORIGIN`. The extension manifest host permission is generated from `VITE_REMOTE_HTTP_ORIGIN` during `npm run build:extension`.

The Railway service uses:

```text
PUBLIC_ORIGIN=http://localhost:8787
PORT=8787
```

For production, set one Railway variable:

```text
PUBLIC_ORIGIN=https://your-chromeremote-service.up.railway.app
```

Then rebuild the extension with:

```text
VITE_REMOTE_HTTP_ORIGIN=https://your-chromeremote-service.up.railway.app
VITE_REMOTE_WS_ORIGIN=wss://your-chromeremote-service.up.railway.app
```

## Chrome Extension Development

Build everything:

```bash
npm run build
```

Run checks:

```bash
npm run lint
npm test
```

Start the relay:

```bash
npm run build:railway
npm start
```

Open `http://localhost:8787/r/test` to verify the mobile remote is served by the relay. Remember that `localhost` on a phone is the phone itself, not the desktop. For real phone testing, deploy the one service publicly over HTTPS/WSS, or configure LAN origins using the desktop computer's local IP where your browser and phone can reach them.

## Railway

The repository includes `railway.json`. Railway should run:

```bash
npm run build:railway
npm start
```

Railway should provide `PORT`; the server binds to `0.0.0.0`. Set `PUBLIC_ORIGIN` to the Railway public domain. The service exposes:

```text
GET /health
POST /api/sessions
DELETE /api/sessions/:sessionId
GET /r/:sessionId
GET /assets/*
WebSocket /ws
```

Sessions are held in memory for this MVP. Run one Railway replica. Restarting or redeploying the service invalidates active remote sessions. Horizontal scaling would require shared state such as Redis later.

## Security

Sessions are temporary and expire after 4 hours or explicit disconnect. The relay generates `sessionId`, `playerToken`, and `controllerToken` with Node crypto, stores token hashes server-side, authenticates both WebSocket roles before forwarding messages, rejects a second simultaneous controller, validates message shape, allow-lists commands, rate-limits command spam, and never logs raw tokens.

The QR URL shape is:

```text
https://your-chromeremote-service.up.railway.app/r/<sessionId>#<controllerToken>
```

The controller token stays in the URL fragment so it is read by the phone app locally and not sent as a normal query string.

## Privacy

ChromeRemote sends only typed remote-control commands and minimal playback state. It does not transmit Netflix passwords, cookies, auth tokens, email, profile data, DRM data, video, audio, video segments, or Widevine information.

ChromeRemote is a remote control, not a casting system. It does not use WebRTC, screen capture, media downloading, debugger permission, native messaging, cookies permission, `webRequest`, or `<all_urls>`.

## Manual Real-Phone Test Plan

1. Start or deploy the relay.
2. Start or deploy the mobile remote.
3. Configure extension origins.
4. Build ChromeRemote.
5. Reload the extension at `chrome://extensions`.
6. Reload Netflix.
7. Start an episode.
8. Open ChromeRemote.
9. Confirm the existing compact desktop UI still looks correct.
10. Confirm Play.
11. Confirm Pause.
12. Confirm -10.
13. Confirm +10.
14. Confirm Next Episode.
15. Confirm Fullscreen/Exit Fullscreen as currently supported.
16. Confirm Mute.
17. Confirm volume +/- and slider.
18. Confirm playback speeds.
19. Press Connect Phone.
20. Confirm the pairing section appears beneath existing controls.
21. Open the shown remote URL on the phone.
22. Confirm the phone shows the ChromeRemote mobile interface.
23. Confirm the phone shows correct time/duration.
24. Close the desktop extension popup.
25. Confirm the phone still works.
26. Pause from phone.
27. Play from phone.
28. -10 from phone.
29. +10 from phone.
30. Drag the seek bar.
31. Test Next Episode.
32. Test Mute.
33. Test volume -.
34. Test volume +.
35. Test volume slider.
36. Test 0.5x.
37. Test 0.75x.
38. Test 1x.
39. Test 1.25x.
40. Test 1.5x.
41. Test Fullscreen remotely if supported.
42. Test Exit Fullscreen remotely if supported.
43. Change controls directly on desktop Netflix.
44. Confirm the phone updates.
45. Go to next episode without page reload.
46. Confirm the phone follows the new player in the same paired tab.
47. Close the paired Netflix tab.
48. Confirm the phone shows Player unavailable.
49. Disconnect the session.
50. Confirm the old remote URL can no longer control Chrome.

Do not treat this checklist as completed until it has been run on a real phone.
