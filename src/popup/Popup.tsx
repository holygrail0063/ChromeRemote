import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { PLAYBACK_RATES, type PlaybackRate, type PlayerCommand, type PlayerResponse } from "../shared/messages";
import { getNetflixPageContext } from "../shared/netflix-url";
import { backgroundUnavailableResponse, decodePairingPayload, type PairingResponse, type PairingState } from "../shared/pairing";
import type { PlayerState } from "../shared/player-state";

type ConnectionStatus = "checking" | "connected" | "player-loading" | "netflix-browsing" | "not-netflix" | "communication-error";

type PopupState = {
  player: PlayerState | null;
  status: ConnectionStatus;
  error: string | null;
};

const initialState: PopupState = {
  player: null,
  status: "checking",
  error: null
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
};

const formatPlaybackRate = (rate: number) => `${Number.isInteger(rate) ? rate.toFixed(0) : rate}x`;

const clampVolume = (value: number) => Math.min(Math.max(value, 0), 1);

const initialPairingState: PairingState = { status: "not-paired" };
const buildId = import.meta.env.VITE_CHROMEREMOTE_BUILD_ID ?? "dev";

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function sendCommand(command: PlayerCommand): Promise<PlayerResponse> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return { ok: false, error: "No active tab is available." };
  }

  const pageContext = getNetflixPageContext(tab.url);
  if (!pageContext.isNetflix) {
    return { ok: false, error: "Open Netflix to use ChromeRemote." };
  }

  if (!pageContext.isWatchPage) {
    return { ok: false, error: "Open a movie or episode to use ChromeRemote." };
  }

  return chrome.tabs.sendMessage(tab.id, command);
}

async function sendPairingRequest(
  message:
    | { type: "REMOTE_PING" }
    | { type: "REMOTE_GET_STATUS" }
    | { type: "REMOTE_CONNECT_PHONE"; tabId: number; tabUrl: string }
    | { type: "REMOTE_DISCONNECT" }
): Promise<PairingResponse> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return backgroundUnavailableResponse();
  }
}

function statusCopy(state: PopupState) {
  if (state.status === "connected") {
    return { label: "Connected", detail: "Netflix watch page and player detected" };
  }

  if (state.status === "player-loading") {
    return { label: "Player loading", detail: "Netflix is open. Waiting for the player..." };
  }

  if (state.status === "netflix-browsing") {
    return { label: "Netflix browsing", detail: "Open a movie or episode to use ChromeRemote." };
  }

  if (state.status === "not-netflix") {
    return { label: "Not Netflix", detail: "Open Netflix to use ChromeRemote." };
  }

  if (state.status === "communication-error") {
    return { label: "Communication error", detail: state.error ?? "Cannot communicate with this Netflix watch page" };
  }

  return { label: "Checking", detail: "Looking for Netflix playback" };
}

export function Popup() {
  const [state, setState] = useState<PopupState>(initialState);
  const [pairing, setPairing] = useState<PairingState>(initialPairingState);
  const [busyCommand, setBusyCommand] = useState<PlayerCommand["type"] | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const refresh = async () => {
    const tab = await getActiveTab();
    if (!tab?.id) {
      setState({ player: null, status: "communication-error", error: "No active tab is available." });
      return;
    }

    const pageContext = getNetflixPageContext(tab.url);
    if (!pageContext.isNetflix) {
      setState({ player: null, status: "not-netflix", error: null });
      return;
    }

    if (!pageContext.isWatchPage) {
      setState({ player: null, status: "netflix-browsing", error: null });
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage<PlayerCommand, PlayerResponse>(tab.id, { type: "GET_STATE" });
      if (!response.ok) {
        setState({
          player: response.state ?? null,
          status: response.state?.detected ? "connected" : "player-loading",
          error: response.error
        });
        return;
      }

      setState({
        player: response.state,
        status: response.state.detected ? "connected" : "player-loading",
        error: null
      });
    } catch {
      setState({
        player: null,
        status: "communication-error",
        error: "ChromeRemote cannot reach the Netflix content script on this watch page. Reload Netflix or reload the extension."
      });
    }
  };

  useEffect(() => {
    void refresh();
    void sendPairingRequest({ type: "REMOTE_PING" }).then((response) => {
      if (!response.ok) {
        setPairing(response.state);
        setPairingError(response.error);
      }
    });
    void sendPairingRequest({ type: "REMOTE_GET_STATUS" }).then((response) => {
      if ("state" in response) {
        setPairing(response.state);
      }
    });
    const intervalId = window.setInterval(() => {
      void refresh();
      void sendPairingRequest({ type: "REMOTE_GET_STATUS" }).then((response) => {
        if ("state" in response) {
          setPairing(response.state);
        }
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const listener = (message: unknown) => {
      if (!message || typeof message !== "object") {
        return;
      }

      const candidate = message as { type?: unknown; state?: PairingState };
      if (candidate.type === "PAIRING_STATE_CHANGED" && candidate.state) {
        setPairing(candidate.state);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (pairing.status !== "waiting" || !pairing.pairingPayload) {
      setQrDataUrl(null);
      setQrError(null);
      return;
    }

    const validation = decodePairingPayload(pairing.pairingPayload);
    if (!validation.ok) {
      setQrDataUrl(null);
      setQrError(validation.error);
      return;
    }

    let cancelled = false;
    setQrDataUrl(null);
    setQrError(null);
    void QRCode.toDataURL(pairing.pairingPayload, {
      errorCorrectionLevel: "M",
      margin: 4,
      width: 204,
      color: {
        dark: "#000000",
        light: "#ffffff"
      }
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrError("ChromeRemote could not generate the phone pairing QR code.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pairing.pairingPayload, pairing.status]);

  const runCommand = async (command: PlayerCommand) => {
    setBusyCommand(command.type);
    try {
      const tab = await getActiveTab();
      const pageContext = getNetflixPageContext(tab?.url);
      const response = await sendCommand(command);
      const commandError = response.ok ? null : response.error;
      setState({
        player: response.state ?? state.player,
        status: response.state?.detected
          ? "connected"
          : !pageContext.isNetflix
            ? "not-netflix"
            : pageContext.isWatchPage
              ? "player-loading"
              : "netflix-browsing",
        error: commandError
      });
    } catch {
      const tab = await getActiveTab();
      const pageContext = getNetflixPageContext(tab?.url);
      setState({
        player: state.player,
        status: pageContext.isWatchPage ? "communication-error" : pageContext.isNetflix ? "netflix-browsing" : "not-netflix",
        error: pageContext.isWatchPage ? "Command failed. Refresh the Netflix tab or reload the extension and try again." : null
      });
    } finally {
      setBusyCommand(null);
    }
  };

  const connectPhone = async () => {
    setPairingError(null);
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url) {
      setPairingError("Open a Netflix movie or episode before connecting a phone.");
      return;
    }

    const response = await sendPairingRequest({ type: "REMOTE_CONNECT_PHONE", tabId: tab.id, tabUrl: tab.url });
    if ("state" in response) {
      setPairing(response.state);
    }
    if (!response.ok) {
      setPairingError(response.error);
    }
  };

  const disconnectPhone = async () => {
    setPairingError(null);
    const response = await sendPairingRequest({ type: "REMOTE_DISCONNECT" });
    if ("state" in response) {
      setPairing(response.state);
    }
    if (!response.ok) {
      setPairingError(response.error);
    }
  };

  const player = state.player;
  const disabled = state.status !== "connected" || !player?.detected || busyCommand !== null;
  const copy = statusCopy(state);
  const progressPercent = useMemo(() => {
    if (!player?.duration) {
      return 0;
    }

    return Math.min((player.currentTime / player.duration) * 100, 100);
  }, [player]);

  const volume = Math.round((player?.volume ?? 0) * 100);
  const playbackRate = player?.playbackRate ?? 1;

  return (
    <main className="popup-shell">
      <header className="topbar">
        <div>
          <h1>ChromeRemote</h1>
          <p>Netflix Player</p>
        </div>
        <span className={`status-pill status-${state.status}`}>
          <span aria-hidden="true" />
          {copy.label}
        </span>
      </header>

      <section className="readout" aria-live="polite">
        <div className="connection-detail">{copy.detail}</div>
        <div className="time-row">
          <strong>{formatTime(player?.currentTime ?? 0)}</strong>
          <span>/</span>
          <strong>{formatTime(player?.duration ?? 0)}</strong>
        </div>
        <div className="progress-track" aria-hidden="true">
          <div style={{ width: `${progressPercent}%` }} />
        </div>
      </section>

      <section className="controls" aria-label="Playback controls">
        <button type="button" disabled={disabled} onClick={() => void runCommand({ type: "SEEK_RELATIVE", seconds: -10 })}>
          -10
        </button>
        <button
          type="button"
          className="primary-control"
          disabled={disabled}
          onClick={() => void runCommand({ type: player?.playing ? "PAUSE" : "PLAY" })}
        >
          {player?.playing ? "Pause" : "Play"}
        </button>
        <button type="button" disabled={disabled} onClick={() => void runCommand({ type: "SEEK_RELATIVE", seconds: 10 })}>
          +10
        </button>
      </section>

      <section className="media-actions" aria-label="Netflix media actions">
        <button type="button" disabled={disabled} onClick={() => void runCommand({ type: "NEXT_EPISODE" })}>
          Next Episode
        </button>
        <button type="button" disabled={disabled} onClick={() => void runCommand({ type: "FULLSCREEN" })}>
          Fullscreen
        </button>
        <button type="button" disabled={disabled} onClick={() => void runCommand({ type: "EXIT_FULLSCREEN" })}>
          Exit Fullscreen
        </button>
        <button type="button" disabled={disabled} onClick={() => void runCommand({ type: "TOGGLE_MUTE" })}>
          {player?.muted ? "Unmute" : "Mute"}
        </button>
      </section>

      <section className="volume-panel" aria-label="Volume controls">
        <div className="volume-header">
          <span>Volume</span>
          <strong>{volume}%</strong>
        </div>
        <div className="volume-row">
          <button
            type="button"
            disabled={disabled}
            aria-label="Volume down"
            onClick={() => void runCommand({ type: "SET_VOLUME", volume: clampVolume((player?.volume ?? 0) - 0.1) })}
          >
            -
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            disabled={disabled}
            aria-label="Volume"
            onChange={(event) => void runCommand({ type: "SET_VOLUME", volume: Number(event.currentTarget.value) / 100 })}
          />
          <button
            type="button"
            disabled={disabled}
            aria-label="Volume up"
            onClick={() => void runCommand({ type: "SET_VOLUME", volume: clampVolume((player?.volume ?? 0) + 0.1) })}
          >
            +
          </button>
        </div>
      </section>

      <section className="speed-panel" aria-label="Playback speed controls">
        <div className="speed-header">Playback Speed</div>
        <div className="speed-options">
          {PLAYBACK_RATES.map((rate) => (
            <button
              key={rate}
              type="button"
              className={Math.abs(playbackRate - rate) < 0.01 ? "selected-speed" : undefined}
              disabled={disabled}
              aria-pressed={Math.abs(playbackRate - rate) < 0.01}
              onClick={() => void runCommand({ type: "SET_PLAYBACK_RATE", rate: rate as PlaybackRate })}
            >
              {formatPlaybackRate(rate)}
            </button>
          ))}
        </div>
      </section>

      <footer className="state-grid">
        <span>Playback</span>
        <strong>{player?.playing ? "Playing" : "Paused"}</strong>
        <span>Speed</span>
        <strong>{formatPlaybackRate(playbackRate)}</strong>
        <span>Muted</span>
        <strong>{player?.muted ? "Yes" : "No"}</strong>
      </footer>

      <section className="phone-panel" aria-label="Control from Phone">
        <div className="phone-title">Control from Phone</div>
        {pairing.status === "not-paired" ? (
          <button type="button" className="phone-action" onClick={() => void connectPhone()}>
            Pair Phone
          </button>
        ) : null}
        {pairing.status === "creating" ? <div className="phone-copy">Creating secure session...</div> : null}
        {pairing.status === "waiting" && pairing.pairingPayload ? (
          <>
            {qrError ? <div className="phone-error">{qrError}</div> : null}
            {!qrError && qrDataUrl ? <img className="qr-code" src={qrDataUrl} width="204" height="204" alt="Phone pairing QR code" /> : null}
            {!qrError && !qrDataUrl ? <div className="phone-copy">Preparing QR code...</div> : null}
            {!qrError ? (
              <>
                <div className="phone-copy">Open ChromeRemote on your phone and scan this code.</div>
                <div className="phone-status">
                  <span aria-hidden="true" /> Waiting for phone...
                </div>
                <button type="button" className="phone-action" onClick={() => void disconnectPhone()}>
                  Cancel Pairing
                </button>
              </>
            ) : null}
          </>
        ) : null}
        {pairing.status === "connected" ? (
          <>
            <div className="phone-status connected">
              <span aria-hidden="true" /> Phone connected
            </div>
            <button type="button" className="phone-action" onClick={() => void disconnectPhone()}>
              Disconnect
            </button>
          </>
        ) : null}
        {pairing.status === "temporarily-disconnected" ? (
          <>
            <div className="phone-status waiting">
              <span aria-hidden="true" /> Phone disconnected
            </div>
            <div className="phone-copy">Waiting for reconnection...</div>
            <button type="button" className="phone-action" onClick={() => void disconnectPhone()}>
              Disconnect
            </button>
          </>
        ) : null}
        {pairing.status === "expired" ? (
          <>
            <div className="phone-copy">Remote session expired</div>
            <button type="button" className="phone-action" onClick={() => void connectPhone()}>
              Create New Session
            </button>
          </>
        ) : null}
        {pairingError ? <div className="phone-error">{pairingError}</div> : null}
      </section>

      {state.error ? <div className="error-message">{state.error}</div> : null}
      <div className="build-meta">Build {buildId}</div>
    </main>
  );
}
