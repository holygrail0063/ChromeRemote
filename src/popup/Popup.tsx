import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { getNetflixPageContext } from "../shared/netflix-url";
import { backgroundUnavailableResponse, decodePairingPayload, type PairingResponse, type PairingState } from "../shared/pairing";
import type { PlayerCommand, PlayerResponse } from "../shared/messages";

type ConnectionStatus = "checking" | "connected" | "player-loading" | "netflix-browsing" | "not-netflix" | "communication-error";

type PopupState = {
  status: ConnectionStatus;
  error: string | null;
};

const initialState: PopupState = {
  status: "checking",
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

function statusCopy(state: PopupState) {
  if (state.status === "connected") {
    return { label: "Netflix ready", detail: "ChromeRemote is connected to this Netflix player." };
  }

  if (state.status === "player-loading") {
    return { label: "Player loading", detail: "Netflix is open. Waiting for playback to become available." };
  }

  if (state.status === "netflix-browsing") {
    return { label: "Netflix browsing", detail: "Open a movie or episode to pair your phone." };
  }

  if (state.status === "not-netflix") {
    return { label: "Not Netflix", detail: "Open Netflix to use ChromeRemote." };
  }

  if (state.status === "communication-error") {
    return { label: "Connection issue", detail: state.error ?? "ChromeRemote cannot reach this Netflix tab." };
  }

  return { label: "Checking", detail: "Looking for an active Netflix player." };
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
      setState({ status: "communication-error", error: "No active tab is available." });
      return;
    }

    const pageContext = getNetflixPageContext(tab.url);
    if (!pageContext.isNetflix) {
      setState({ status: "not-netflix", error: null });
      return;
    }

    if (!pageContext.isWatchPage) {
      setState({ status: "netflix-browsing", error: null });
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage<PlayerCommand, PlayerResponse>(tab.id, { type: "GET_STATE" });
      if (!response.ok) {
        setState({
          status: response.state?.detected ? "connected" : "player-loading",
          error: response.error
        });
        return;
      }

      setState({
        status: response.state.detected ? "connected" : "player-loading",
        error: null
      });
    } catch {
      setState({
        status: "communication-error",
        error: "ChromeRemote cannot reach the Netflix player. Reload Netflix or reload the extension."
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
      setPairingError("Open a Netflix movie or episode before pairing your phone.");
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

  return (
    <main className="popup-shell">
      <header className="topbar">
        <div>
          <h1>ChromeRemote</h1>
          <p>Pair Netflix with your phone</p>
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
            <div className="phone-copy">Pair a phone to use ChromeRemote as your Netflix remote.</div>
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
