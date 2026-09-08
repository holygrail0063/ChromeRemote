# ChromeRemote

ChromeRemote turns your phone into a remote control for Netflix and YouTube playing in desktop Chrome.

Since **v1.8.0**, the phone pairs to **ChromeRemote itself**, not to one specific Netflix or YouTube tab. Pair once, then switch between supported tabs in Chrome and the phone remote follows whichever supported tab is active.

**v1.9.0** is a reliability release focused on three areas: fullscreen rendering, Netflix Next Episode behavior, and phone state synchronization when switching between Netflix and YouTube.

The Chrome extension stays on the computer, creates a temporary authenticated session, and shows a QR code. Your phone scans that QR code, connects to the same session, and becomes the remote.

## What ChromeRemote Can Control

From the phone remote you can currently use:

- Play / Pause
- Rewind 10 seconds
- Forward 10 seconds
- Seek through the current video
- Next Episode on Netflix / Next Video on YouTube
- YouTube search from the phone
- Browse YouTube search results with Previous / Next / Open Video
- Player-only Fullscreen
- Exit Fullscreen
- Mute / Unmute
- Volume down / up
- Volume slider
- Playback speed: `0.5x`, `0.75x`, `1x`, `1.25x`, `1.5x`
- Current title details when the page exposes them

The YouTube search bar appears only while the active Chrome tab is YouTube. It is hidden on Netflix.

The extension popup is used for status, phone pairing, the QR code, and disconnecting the phone. Playback controls live on the phone.

---

# Install ChromeRemote

## Recommended: download the ready-to-use extension ZIP

Normal users do **not** need Node.js, npm, Git, Railway, or any build tools.

1. Open the repository's **Releases** page:
   `https://github.com/holygrail0063/ChromeRemote/releases`
2. Open the latest ChromeRemote release.
3. Download **`ChromeRemote-Extension.zip`**.
4. Extract the ZIP to a permanent folder on your computer.
5. In desktop Chrome, open `chrome://extensions`.
6. Turn on **Developer mode**.
7. Click **Load unpacked**.
8. Select the extracted ChromeRemote folder.
9. Optional: pin ChromeRemote from Chrome's Extensions menu.

The prebuilt extension already points to the hosted ChromeRemote phone/relay service:

```text
https://chromeremote-production.up.railway.app
```

> ChromeRemote is not currently published in the Chrome Web Store, so Chrome's **Load unpacked** flow is required.

## Optional: build from source

```bash
git clone https://github.com/holygrail0063/ChromeRemote.git
cd ChromeRemote
npm ci
npm run build:extension:production
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist/` folder.

---

# How to Use ChromeRemote

## 1. Pair your phone once

Open the ChromeRemote extension popup and click:

```text
Pair Phone
```

ChromeRemote creates a temporary session and shows a QR code.

The session belongs to the ChromeRemote extension, **not to the tab that happened to be open when the QR was created**.

## 2. Scan the QR code

### Option A: normal phone camera

Open the normal camera app on your phone and scan the QR code shown by the extension.

Tap the link shown by the phone. The ChromeRemote phone page opens with the temporary pairing data in the URL fragment.

### Option B: ChromeRemote scanner

On the phone, open:

```text
https://chromeremote-production.up.railway.app/remote_session
```

Tap **Open Camera**, allow camera access, and scan the QR code shown by the extension.

## 3. Switch to Netflix or YouTube on the computer

ChromeRemote routes commands to the **currently active supported Chrome tab**.

Supported behavior:

- Switch from a Netflix tab to a YouTube tab: the phone remote follows YouTube automatically.
- Switch from YouTube back to Netflix: the phone remote follows Netflix automatically.
- Navigate YouTube from a watch page to search results: the same phone session remains connected.
- Open an unsupported tab: the phone stays paired but playback controls wait until Netflix or YouTube becomes active again.

You do **not** need another QR just because you switch between Netflix and YouTube.

## 4. Start playback

For Netflix, open a movie or episode on a `netflix.com/watch/...` page.

For YouTube, open a normal watch page such as `youtube.com/watch?v=...`.

The extension background worker watches Chrome tab activation and player state changes, then sends the active player's state to the phone.

## 5. Control playback from the phone

Once paired, the extension popup can be closed. The Manifest V3 background service worker keeps the session alive and routes commands to the active supported tab.

Starting with **v1.9.0**, the phone also requests a fresh player state every **500 ms** while connected. This acts as a recovery watchdog if a tab switch, Netflix route change, or temporary player-loading state causes one pushed update to be missed.

The phone page can be refreshed and should reconnect to the same active session while the session is still valid, but normal tab switching should no longer require manual refreshes.

## 6. Search and browse YouTube from the phone

When the active tab is YouTube, the phone remote shows **Search YouTube**.

Enter a search and tap **Search**. The active desktop YouTube tab opens YouTube's normal search-results page.

While the desktop is on YouTube search results:

- the phone remains paired
- the YouTube search field remains available
- playback buttons are disabled because no main watch video is active
- **Previous** and **Next** move a visible highlight through search results
- ChromeRemote scrolls the selected result into view
- **Open Video** opens the highlighted result
- playback controls become active again when the selected video opens

ChromeRemote only treats YouTube's main watch-player video as controllable. Hover-preview videos on search pages are ignored.

## 7. Disconnect

On the phone, tap the green **Connected** pill and choose **Disconnect from Chrome**.

You can also disconnect from the ChromeRemote extension popup.

Disconnecting invalidates the temporary session so the old pairing link can no longer control the desktop.

---

# Chrome-wide Session Behavior

ChromeRemote removed the old permanent `pairedTabId` design in v1.8.0.

The background service worker now:

- owns one authenticated phone session for the extension
- finds the active tab in the last-focused Chrome window for each command/state update
- supports active Netflix and YouTube tabs
- immediately pushes a new player state when Chrome tabs change
- automatically cleans up ChromeRemote player-only fullscreen on the previous tab when switching away
- retries briefly when a newly activated supported tab is still loading its content script
- starts desktop player-state polling as soon as the extension WebSocket authenticates

The v1.9.0 phone-side state watchdog adds an independent refresh path, so the phone does not depend only on desktop-pushed state events to recover after a platform/tab switch.

---

# Fullscreen Behavior

Web browsers require a **trusted local user gesture** for the real Fullscreen API. A command arriving from a phone over WebSocket cannot provide that user activation.

ChromeRemote therefore does **not** press YouTube/Netflix's native fullscreen button and does **not** use Chrome's F11-style browser-window fullscreen.

In v1.9.0, phone **Fullscreen** uses a player-shell viewport mode:

1. ChromeRemote finds the site's own player shell that contains the visible video.
2. It removes only ancestor clipping/transform constraints that could trap that player shell inside the page layout.
3. It expands the site-owned player shell to the full browser content viewport.
4. It leaves the raw `<video>` rendering element inside its original player hierarchy.
5. It does **not** add a separate black overlay above or behind a moved video element.
6. **Exit Fullscreen** removes the temporary player-shell classes and restores the normal page layout.

This design specifically avoids the v1.8.0 approach that fixed the raw video element directly and could result in a black screen on YouTube or Netflix.

Because this is intentionally not F11/browser fullscreen, Chrome's tab bar and address bar may remain visible. Hiding Chrome's own UI remotely would require true browser fullscreen, which Chrome does not allow without a trusted local action.

---

# Netflix Notes

Netflix seeking must not use a direct `HTMLVideoElement.currentTime` write because that can trigger Netflix error **M7375**.

ChromeRemote keeps a Netflix MAIN-world adapter and uses Netflix's internal player-session seek operation for normal seeking.

For **Next Episode** in v1.9.0:

- ChromeRemote first tries Netflix's own player-session `playNextEpisode()` action on the best available watch/active session.
- It verifies whether Netflix transitions to another episode and can retry another eligible session if needed.
- If the internal action is unavailable, ChromeRemote looks for Netflix's real rendered Next Episode control and activates it.
- ChromeRemote **does not seek the current episode to its end** just to make the Next Episode button appear.
- If Netflix exposes neither a working internal next-episode action nor a usable Next Episode control, the command fails safely without moving playback to a black post-play frame.

The build verifier prevents Netflix code from introducing direct `video.currentTime` writes.

---

# YouTube Notes

YouTube uses its main `video.html5-main-video` watch-player element for standard playback.

Mute / Unmute uses YouTube's own player API when available, with YouTube's native mute control as fallback.

YouTube direct seek is isolated in a hostname-guarded YouTube helper and is never reused for Netflix.

---

# Updating the Extension

Unpacked Chrome extensions do not update themselves from GitHub.

When a newer ChromeRemote release is available:

1. Download the new `ChromeRemote-Extension.zip` from GitHub Releases.
2. Extract it over your existing ChromeRemote extension folder, or extract it to a new permanent folder.
3. Open `chrome://extensions`.
4. Click **Reload** on ChromeRemote. If using a new folder, remove the old unpacked extension and load the new folder.
5. Refresh open Netflix and YouTube pages.
6. Pair a new phone session after an extension upgrade.

---

# Pairing and Security

When **Pair Phone** is pressed, the relay creates:

- a random `sessionId`
- a random `playerToken` for the Chrome extension
- a random `controllerToken` for the phone

The QR code contains the session-specific phone pairing data. The controller token is placed in the URL fragment after `#` rather than in a normal HTTP query parameter.

Sessions currently:

- expire after 4 hours
- can be explicitly disconnected at any time
- maintain one active phone controller connection per session
- replace an older controller connection when the same paired phone reconnects
- are stored in memory on the relay for this MVP

A Railway service restart or redeploy invalidates active sessions because there is currently no persistent shared session database.

---

# Architecture

ChromeRemote does not stream Netflix or YouTube media to the phone. The phone only sends remote-control commands.

```text
Phone browser
    |
    | HTTPS / WebSocket
    v
ChromeRemote relay
    |
    v
Chrome extension background service worker
    |
    | resolves active supported tab
    v
Active Netflix or YouTube tab
    |
    v
Supported web player
```

The popup does not need to remain open after pairing.

The background service worker owns:

- the Chrome-wide phone session
- relay WebSocket connection
- session reconnect state
- controller connection status
- active supported-tab resolution
- tab-change player-state updates
- player-state polling

The phone remote also runs its own connected-state watchdog so it can actively request current player state instead of relying only on pushed updates.

Netflix keeps its dedicated MAIN-world adapter for Netflix-specific operations. YouTube uses the main HTML5 watch-player video for standard playback controls.

---

# Privacy

ChromeRemote is a remote control, not a casting or media-download system.

It does **not** send video or audio through the relay.

ChromeRemote does not intentionally transmit:

- Netflix or YouTube passwords
- site cookies
- authentication tokens
- email addresses
- DRM / Widevine data
- video segments
- audio segments
- screen captures

The relay receives typed remote-control messages and minimal player state required to keep the phone UI synchronized.

For YouTube search, the typed search phrase is sent through the authenticated ChromeRemote session to the active YouTube tab so that tab can open a normal YouTube search URL.

The relay:

- generates cryptographically random pairing secrets
- stores hashes of session tokens server-side
- authenticates both desktop and phone WebSocket connections
- allow-lists supported commands
- validates YouTube search commands and limits search length
- rate-limits command traffic
- expires temporary sessions
- invalidates sessions when disconnected

ChromeRemote does not request `<all_urls>`, cookie access, debugger access, native messaging, or `webRequest` access.

---

# Troubleshooting

## The extension folder cannot be loaded

Select the extracted release folder that directly contains `manifest.json`, not the ZIP and not an extra parent folder.

## The phone stays on Connecting or does not recover after switching sites

v1.9.0 keeps requesting active player state every 500 ms while the phone WebSocket is connected. Normal Netflix/YouTube switching should recover automatically without refreshing the phone.

If it remains stuck for several seconds:

1. confirm the extension popup still says the phone is connected
2. confirm Netflix or YouTube is the active tab in the last-focused Chrome window
3. refresh the Netflix/YouTube page after updating the extension
4. reload ChromeRemote from `chrome://extensions`
5. create a fresh QR session

## Playback controls are disabled

This is expected when:

- an unsupported Chrome tab is active
- Netflix/YouTube is still loading
- YouTube is showing search results instead of a watch video

The phone remains paired. Switch/open a playable Netflix or YouTube page and controls should become active again.

## Fullscreen does not hide the Chrome toolbar

That is expected. ChromeRemote player fullscreen fills the **webpage viewport**, not Chrome's F11/browser fullscreen. Chrome requires a local trusted action to enter true native fullscreen.

## The phone remote disconnects after a Railway deployment

Sessions are stored in relay memory. A server restart or deployment clears active sessions. Create a new QR session.

---

# Automated Validation

For v1.9.0 the release branch validates:

```bash
npm run lint
npm run build:extension:production
npm run build:railway
npm test
```

Additional regression guards verify that:

- fullscreen expands site player shells instead of fixing the raw video element
- the v1.8.0 fullscreen overlay path is gone
- Netflix Next Episode does not seek the current episode to the end
- Netflix Next Episode includes internal `playNextEpisode()` and rendered-control paths
- the phone state watchdog remains active after the first player-state message
- Chrome-wide active-tab routing remains intact
- Netflix's M7375-safe seek restrictions remain intact

These automated checks validate the code/build invariants. Netflix and YouTube are live third-party websites with authenticated/DRM playback, so final live-site behavior should also be smoke-tested after installing the release.

---

# Development

Normal users can ignore this section and use the release ZIP.

```bash
npm ci
npm run lint
npm test
npm run build:extension:production
npm run build:railway
```

Build everything:

```bash
npm run build
```

Start the relay/server:

```bash
npm start
```

Local development defaults include:

```text
http://localhost:8787
ws://localhost:8787
```

Remember that `localhost` on a phone means the phone itself, not the computer.

---

# Extension Release Packaging

The GitHub Actions release workflow:

1. installs dependencies with `npm ci`
2. runs `npm run build:extension:production`
3. verifies the production extension build
4. adds `INSTALL.txt`
5. packages `dist/` as `ChromeRemote-Extension.zip`
6. publishes the ZIP under the GitHub release matching `public/manifest.json`

---

# Self-Hosting

The repository includes `railway.json` and can be deployed as one Railway service.

Production service build:

```bash
npm run build:railway
```

Start:

```bash
npm start
```

For your own deployment configure:

```text
PUBLIC_ORIGIN=https://your-domain.example
VITE_REMOTE_HTTP_ORIGIN=https://your-domain.example
VITE_REMOTE_WS_ORIGIN=wss://your-domain.example
```

Then rebuild the extension so its production bundle points to your relay.

The server exposes:

```text
GET    /health
POST   /api/sessions
DELETE /api/sessions/:sessionId
GET    /remote_session
GET    /r/:sessionId
GET    /assets/*
WS     /ws
```

For the current in-memory session implementation, use a single relay replica unless you add shared session storage.

---

# Project Structure

```text
ChromeRemote/
├─ .github/workflows/  validation and release packaging
├─ src/
│  ├─ background/      MV3 service worker and Chrome-wide phone-session router
│  ├─ content/         supported-site content script and command routing
│  ├─ netflix/         Netflix adapter and M7375-safe player operations
│  ├─ popup/           pairing/status extension popup
│  ├─ shared/          protocol, pairing, state, URL, and config types
│  └─ youtube/         YouTube-specific player helpers
├─ remote/             phone React application
├─ server/             Node.js relay service
├─ scripts/            build/release safety checks
├─ tests/              automated tests
├─ public/             extension manifest/static assets
├─ railway.json        Railway deployment configuration
└─ package.json        root build/test commands
```

---

# Important Notes

- ChromeRemote currently targets Netflix and YouTube in desktop Chrome.
- It is an independent project and is not affiliated with or endorsed by Netflix, YouTube, or Google.
- Supported sites can change their web player implementations at any time, which may require compatibility updates.
- The extension is currently installed as an unpacked extension rather than through the Chrome Web Store.
