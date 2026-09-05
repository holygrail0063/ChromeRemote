# ChromeRemote

ChromeRemote turns your phone into a remote control for Netflix playing in desktop Chrome.

The Chrome extension stays on the computer, creates a temporary pairing session, and shows a QR code. Your phone scans that QR code, connects to the same session, and becomes the remote.

## What ChromeRemote Can Control

From the phone remote you can currently use:

- Play / Pause
- Rewind 10 seconds
- Forward 10 seconds
- Seek through the current title
- Next Episode
- Fullscreen
- Exit Fullscreen
- Mute / Unmute
- Volume down / up
- Volume slider
- Playback speed: `0.5x`, `0.75x`, `1x`, `1.25x`, `1.5x`
- Show / episode details when Netflix exposes them to the page

The extension popup itself is intentionally simple. It is used for Netflix status, phone pairing, the QR code, and disconnecting the phone. The actual playback controls live on the phone.

---

# Install ChromeRemote

## Recommended: download the ready-to-use extension ZIP

Normal users do **not** need Node.js, npm, Railway, or any build tools.

1. Open the repository's **Releases** page:
   `https://github.com/holygrail0063/ChromeRemote/releases`
2. Open the latest ChromeRemote release.
3. Download **`ChromeRemote-Extension.zip`** from the release assets.
4. Extract the ZIP to a permanent folder on your computer. Do not delete this folder after loading the extension.
5. In desktop Chrome, open `chrome://extensions`.
6. Turn on **Developer mode** in the top-right corner.
7. Click **Load unpacked**.
8. Select the folder you extracted from `ChromeRemote-Extension.zip`.
9. Pin ChromeRemote from Chrome's Extensions menu if you want quick access to it.

That is the full installation. The prebuilt extension already points to the hosted ChromeRemote phone/relay service:

```text
https://chromeremote-production.up.railway.app
```

You do not need to deploy your own server to use the hosted version.

> ChromeRemote is not currently published in the Chrome Web Store, so Chrome's **Load unpacked** flow is required.

## Optional: build from source

Developers who prefer to build the extension themselves can clone the repository:

```bash
git clone https://github.com/holygrail0063/ChromeRemote.git
cd ChromeRemote
npm ci
npm run build:extension:production
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist/` folder.

---

# How to Use ChromeRemote

## 1. Start Netflix on the computer

Open Netflix in desktop Chrome and start playing a movie or episode.

ChromeRemote pairs to the exact Netflix watch tab that is active when you create the session.

## 2. Open the ChromeRemote extension

Click the ChromeRemote extension icon.

You should see a status such as:

```text
Netflix ready
```

If ChromeRemote says Netflix is not ready, make sure you are on an active Netflix watch page and refresh Netflix if necessary.

## 3. Pair your phone

Click:

```text
Pair Phone
```

ChromeRemote creates a temporary session and shows a QR code.

That QR code is unique to the pairing session. It contains a randomly generated session ID and controller token, so another random ChromeRemote session cannot control your Netflix tab.

## 4. Scan the QR code

You have two supported ways to connect the phone.

### Option A: scan with the normal phone camera

Open the normal camera app on your phone and point it at the ChromeRemote QR code.

The QR opens the ChromeRemote phone page and includes the temporary pairing information in the URL fragment.

Tap the link shown by the phone. ChromeRemote opens already connected to that desktop session.

### Option B: use the ChromeRemote scanner

On the phone, open:

```text
https://chromeremote-production.up.railway.app/remote_session
```

Tap **Open Camera**, allow camera access, and scan the QR code shown by the extension.

The phone then connects to the exact ChromeRemote session created by your computer.

## 5. Control Netflix from your phone

Once paired, the phone displays the ChromeRemote controls.

The extension popup can be closed. The Chrome background service worker continues to own the session and routes phone commands to the paired Netflix tab.

The phone remote stays associated with the same session when the phone page is refreshed. The temporary session information is kept in the URL fragment so the phone can reconnect to the same desktop session.

## 6. Disconnect

You can disconnect from either side.

On the phone, tap the green **Connected** pill and choose:

```text
Disconnect from Chrome
```

You can also disconnect the phone from the ChromeRemote extension popup.

Disconnecting invalidates the temporary session so the old pairing URL can no longer control the desktop.

---

# Phone Remote Controls

The phone remote currently provides:

```text
ChromeRemote                         Connected
Netflix Player

[ Next Episode ]       [ Fullscreen ]
[ Exit Fullscreen ]    [ Mute / Unmute ]

Volume
[ - ] -------- slider -------- [ + ]

Current Time / Duration
--------- seek slider ---------

[ -10 ]      [ Play / Pause ]      [ +10 ]

Playback Speed
[ 0.5x ] [ 0.75x ] [ 1x ] [ 1.25x ] [ 1.5x ]
```

The layout automatically scales for phone-sized displays.

---

# Updating the Extension

When a newer ChromeRemote release is available:

1. Download the new `ChromeRemote-Extension.zip` from GitHub Releases.
2. Extract it to your ChromeRemote extension folder, replacing the previous files, or extract it to a new folder.
3. Open `chrome://extensions`.
4. Click **Reload** on ChromeRemote. If you used a new folder, remove the old unpacked extension and load the new folder instead.
5. Refresh any open Netflix watch tabs.

---

# Pairing and Session Behavior

ChromeRemote uses temporary authenticated sessions.

When **Pair Phone** is pressed, the relay creates:

- a random `sessionId`
- a random `playerToken` for the Chrome extension
- a random `controllerToken` for the phone

The QR code includes the session-specific phone pairing data. The controller token is placed in the URL fragment after `#`, so it is handled by the phone application rather than sent as a normal HTTP query parameter.

Sessions currently:

- expire after 4 hours
- can be explicitly disconnected at any time
- allow one active phone controller per session
- are stored in memory on the relay for this MVP

A Railway service restart or redeploy invalidates active sessions because there is currently no persistent shared session database.

---

# Architecture

ChromeRemote does not stream Netflix video to the phone. The phone only sends remote-control commands.

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
    v
Paired Netflix tab
    |
    v
Netflix player adapter
```

The extension popup is not required to remain open after pairing.

The background service worker owns:

- the paired Netflix tab ID
- relay WebSocket connection
- session reconnect state
- controller connection status
- player state polling while the phone is connected

Netflix player control remains inside the extension and Netflix page integration.

---

# Privacy and Security

ChromeRemote is a remote control, not a casting or media-download system.

It does **not** send the Netflix video or audio through the relay.

ChromeRemote does not intentionally transmit:

- Netflix passwords
- Netflix cookies
- Netflix authentication tokens
- email addresses
- Netflix profile information
- DRM / Widevine data
- video segments
- audio segments
- screen captures

The relay receives typed remote-control messages and minimal player state required to keep the phone UI synchronized.

The relay:

- generates cryptographically random pairing secrets
- stores hashes of session tokens server-side
- authenticates both the desktop and phone WebSocket connections
- allow-lists supported remote commands
- rate-limits command traffic
- expires temporary sessions
- invalidates sessions when disconnected

ChromeRemote does not request `<all_urls>`, cookie access, debugger access, native messaging, or `webRequest` access.

---

# Troubleshooting

## Chrome says the extension folder cannot be loaded

Make sure you selected the **extracted release folder containing `manifest.json`**, not the ZIP file itself and not an extra parent folder.

## The extension says Netflix is not ready

Make sure:

1. Netflix is open in Chrome.
2. You are on a `/watch/...` page.
3. A movie or episode has actually loaded.
4. Refresh Netflix after reloading or updating the extension.

## Pair Phone does not show a QR code

Reload the unpacked extension from:

```text
chrome://extensions
```

Then refresh the Netflix tab and try **Pair Phone** again.

## The phone cannot scan the QR code

Try either pairing method:

- scan the QR with the phone's normal camera, or
- open `https://chromeremote-production.up.railway.app/remote_session`, tap **Open Camera**, and scan from inside ChromeRemote

Make sure the QR code is fully visible and the phone has camera permission.

## The phone remote disconnects after a service deployment

Sessions are currently held in relay memory. A server restart or Railway deployment clears active sessions.

Create a new session from the extension and scan the new QR code.

## I refreshed the phone page

The phone should reconnect to the same active session because the session information is kept in the URL fragment.

If the session has expired or was disconnected, create a new pairing session from the extension.

## Controls stop responding after changing episodes

Wait a moment for Netflix to replace or update its player, then try again. ChromeRemote resolves the current Netflix player instead of permanently holding the original video element.

---

# Development

Normal users can ignore this section and install the prebuilt release ZIP instead.

Install dependencies:

```bash
npm ci
```

Build everything:

```bash
npm run build
```

Build only the production extension:

```bash
npm run build:extension:production
```

Run type/lint checks:

```bash
npm run lint
```

Run tests:

```bash
npm test
```

Build the Railway server and mobile remote:

```bash
npm run build:railway
```

Start the server:

```bash
npm start
```

For local development, the repository includes development environment configuration for:

```text
http://localhost:8787
ws://localhost:8787
```

Remember: `localhost` on a phone means the phone itself, not your computer.

---

# Extension Release Packaging

The repository automatically builds a ready-to-load extension package with GitHub Actions.

The release workflow:

1. installs dependencies with `npm ci`
2. runs `npm run build:extension:production`
3. verifies the production extension build
4. packages the contents of `dist/` as `ChromeRemote-Extension.zip`
5. publishes that ZIP under the GitHub release matching the version in `package.json`

This keeps the public download package separate from source code and ensures users receive the production-configured extension.

---

# Self-Hosting the Relay

The repository includes `railway.json` and can be deployed as one Railway service.

The production service builds with:

```bash
npm run build:railway
```

and starts with:

```bash
npm start
```

For your own deployment, configure:

```text
PUBLIC_ORIGIN=https://your-domain.example
VITE_REMOTE_HTTP_ORIGIN=https://your-domain.example
VITE_REMOTE_WS_ORIGIN=wss://your-domain.example
```

Then rebuild the extension so its background bundle and manifest point to your relay domain.

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

For the current in-memory session implementation, run a single relay replica. Horizontal scaling would require shared session state such as Redis or another shared store.

---

# Project Structure

```text
ChromeRemote/
├─ .github/workflows/  automated extension release packaging
├─ src/
│  ├─ background/      MV3 service worker and phone-session bridge
│  ├─ content/         Netflix tab content script
│  ├─ netflix/         Netflix player integration
│  ├─ popup/           pairing/status extension popup
│  └─ shared/          shared protocol, pairing, state, and config types
├─ remote/             phone React application
├─ server/             Node.js relay service
├─ scripts/            extension/server build verification scripts
├─ tests/              automated tests
├─ public/             extension manifest/static assets
├─ railway.json        Railway deployment configuration
└─ package.json        root build/test commands
```

---

# Important Notes

- ChromeRemote currently targets Netflix in desktop Chrome.
- It is an independent project and is not affiliated with or endorsed by Netflix.
- Netflix can change its web player implementation at any time, which may require ChromeRemote compatibility updates.
- The extension is currently installed as an unpacked extension rather than through the Chrome Web Store.
