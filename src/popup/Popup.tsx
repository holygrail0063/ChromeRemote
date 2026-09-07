import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { getNetflixPageContext, type SupportedPlayerSite } from "../shared/netflix-url";
import { backgroundUnavailableResponse, decodePairingPayload, type PairingResponse, type PairingState } from "../shared/pairing";
import type { PlayerCommand, PlayerResponse } from "../shared/messages";

type ConnectionStatus = "checking" | "connected" | "player-loading" | "supported-browsing" | "unsupported-site" | "communication-error";

type PopupState = {
  status: ConnectionStatus;
  site: SupportedPlayerSite | null;
  error: string | null;
};

const initialState: PopupState = {
  status: "checking",
  site: null,
  error: null
};

const initialPairingState: PairingState = { status: "not-paired" };
const buildId = import.meta.env.VITE_CHROMEREMOTE_BUILD_ID ?? "dev";

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
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

function siteName(site: SupportedPlayerSite | null): string {
  return site === "youtube" ? "YouTube" : site === "netflix" ? "Netflix" : "supported video";
}

function statusCopy(state: PopupState) {
  const name = siteName(state.site);
  if (state.status === "connected") {
    return { label: `${name} ready`, detail: `ChromeRemote is connected to this ${name} player.` };
  }

  if (state.status === "player-loading") {
    return { label: "Player loading", detail: `${name} is open. Waiting for playback to become available.` };
  }

  if (state.status === "supported-browsing") {
    return { label: `${name} browsing`, detail: `Open a ${state.site === "youtube" ? "video" : "movie or episode"} to pair your phone.` };
  }

  if (state.status === "unsupported-site") {
    return { label: "Unsupported page", detail: "Open Netflix or a YouTube video to use ChromeRemote." };
  }

  if (state.status === "communication-error") {
    return { label: "Connection issue", detail: state.error ?? `ChromeRemote cannot reach this ${name} tab.` };
  }

  return { label: "Checking", detail: "Looking for an active Netflix or YouTube player." };
}

export function Popup() {
  const [state, setState] = useState<PopupState>(initialState);
  const [pairing, setPairing] = useState<PairingState>(initialPairingState);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const refresh = async () => {
    const tab = await getActiveTab();
    if (!tab?.id) {
      setState({ status: "communication-error", site: null, error: "No active tab is available." });
      return;
    }

    const pageContext = getNetflixPageContext(tab.url);
    if (!pageContext.isSupportedSite) {
      setState({ status: "unsupported-site", site: null, error: null });
      return;
    }

    if (!pageContext.isPlaybackPage) {
      setState({ status: "supported-browsing", site: pageContext.site, error: null });
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage<PlayerCommand, PlayerResponse>(tab.id, { type: "GET_STATE" });
      if (!response.ok) {
        setState({
          status: response.state?.detected ? "connected" : "player-loading",
          site: pageContext.site,
          error: response.error
        });
        return;
      }

      setState({
        status: response.state.detected ? "connected" : "player-loading",
        site: pageContext.site,
        error: null
      });
    } catch {
      setState({
        status: "communication-error",
        site: pageContext.site,
        error: `ChromeRemote cannot reach the ${siteName(pageContext.site)} player. Reload the video page or reload the extension.`
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
      width: 220,
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
          setQrError("ChromeRemote could not generate the pairing QR code.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pairing.pairingPayload, pairing.status]);

  const connectPhone = async () => {
    setPairingError(null);
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url) {
      setPairingError("Open a Netflix title or YouTube video before pairing your phone.");
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

  const copy = statusCopy(state);
  const currentSite = siteName(state.site);

  return (
    <main className="popup-shell">
      <header className="topbar">
        <div>
          <h1>ChromeRemote</h1>
          <p>Pair Netflix or YouTube with your phone</p>
        </div>
      </header>

      <section className="desktop-status" aria-live="polite">
        <div className={`status-line status-${state.status}`}>
          <span aria-hidden="true" />
          <strong>{copy.label}</strong>
        </div>
        <div className="connection-detail">{copy.detail}</div>
      </section>

      <section className="phone-panel" aria-label="Phone pairing">
        <div className="phone-title">Phone Remote</div>

        {pairing.status === "not-paired" ? (
          <>
            <div className="phone-copy">Pair a phone to use ChromeRemote as your {state.site ? currentSite : "video"} remote.</div>
            <button type="button" className="phone-action primary-action" disabled={state.status !== "connected"} onClick={() => void connectPhone()}>
              Pair Phone
            </button>
          </>
        ) : null}

        {pairing.status === "creating" ? <div className="phone-copy">Creating secure session...</div> : null}

        {pairing.status === "waiting" && pairing.pairingPayload ? (
          <>
            {qrError ? <div className="phone-error">{qrError}</div> : null}
            {!qrError && qrDataUrl ? <img className="qr-code" src={qrDataUrl} width="220" height="220" alt="Phone pairing QR code" /> : null}
            {!qrError && !qrDataUrl ? <div className="phone-copy">Preparing QR code...</div> : null}
            {!qrError ? (
              <>
                <div className="phone-copy centered-copy">Scan this code with your phone.</div>
                <div className="phone-status waiting">
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
            <div className="phone-copy">Your phone is now the ChromeRemote controller. You can close this popup.</div>
            <button type="button" className="phone-action" onClick={() => void disconnectPhone()}>
              Disconnect Phone
            </button>
          </>
        ) : null}

        {pairing.status === "temporarily-disconnected" ? (
          <>
            <div className="phone-status waiting">
              <span aria-hidden="true" /> Phone disconnected
            </div>
            <div className="phone-copy">Waiting for the phone to reconnect...</div>
            <button type="button" className="phone-action" onClick={() => void disconnectPhone()}>
              Disconnect Phone
            </button>
          </>
        ) : null}

        {pairing.status === "expired" ? (
          <>
            <div className="phone-copy">The remote session expired.</div>
            <button type="button" className="phone-action primary-action" disabled={state.status !== "connected"} onClick={() => void connectPhone()}>
              Create New Session
            </button>
          </>
        ) : null}

        {pairingError ? <div className="phone-error">{pairingError}</div> : null}
      </section>

      {state.error && state.status === "communication-error" ? <div className="error-message">{state.error}</div> : null}
      <div className="build-meta">Build {buildId}</div>
    </main>
  );
}
