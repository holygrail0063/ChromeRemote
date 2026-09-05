import { useEffect, useMemo, useRef, useState } from "react";
import { PLAYBACK_RATES, type PlaybackRate, type PlayerCommand } from "../../src/shared/messages";
import { decodePairingPayload, stopMediaStreamTracks } from "../../src/shared/pairing";
import type { PlayerState } from "../../src/shared/player-state";
import { RemoteSocket, type RemoteSnapshot } from "./socket";

const emptySnapshot: RemoteSnapshot = {
  status: "connecting",
  state: null,
  message: "Connecting to Chrome..."
};

const clampVolume = (value: number) => Math.min(Math.max(value, 0), 1);
const formatPlaybackRate = (rate: number) => `${Number.isInteger(rate) ? rate.toFixed(0) : rate}x`;
const invalidPairingCodeMessage = "That isn't a ChromeRemote pairing code.";

type ControllerSession = {
  sessionId: string;
  token: string;
  source: "url" | "scan";
};

type ScannerStatus = "idle" | "starting" | "scanning" | "error";

type ScannerControls = {
  stop(): void;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function sessionFromUrl(): ControllerSession | null {
  const legacyMatch = window.location.pathname.match(/\/r\/([^/]+)/);
  const fragment = window.location.hash.slice(1);
  if (legacyMatch && fragment) {
    return { sessionId: decodeURIComponent(legacyMatch[1]), token: fragment, source: "url" };
  }

  if (window.location.pathname === "/remote_session" && fragment) {
    const decoded = decodePairingPayload(fragment);
    if (decoded.ok) {
      return {
        sessionId: decoded.payload.sessionId,
        token: decoded.payload.controllerToken,
        source: "url"
      };
    }
  }

  return null;
}

export function App() {
  const [snapshot, setSnapshot] = useState<RemoteSnapshot>(emptySnapshot);
  const [localSeek, setLocalSeek] = useState<number | null>(null);
  const [localVolume, setLocalVolume] = useState<number | null>(null);
  const [scannedSession, setScannedSession] = useState<ControllerSession | null>(null);
  const socketRef = useRef<RemoteSocket | null>(null);
  const urlSession = useMemo(sessionFromUrl, []);
  const session = scannedSession ?? urlSession;
  const player = snapshot.state;
  const disabled = snapshot.status !== "connected" || !player?.detected;
  const progress = localSeek ?? player?.currentTime ?? 0;
  const volume = localVolume ?? Math.round((player?.volume ?? 0) * 100);
  const playbackRate = player?.playbackRate ?? 1;

  useEffect(() => {
    if (!session) {
      setSnapshot(emptySnapshot);
      return;
    }

    const remote = new RemoteSocket(session.sessionId, session.token, setSnapshot);
    socketRef.current = remote;
    remote.connect();
    return () => remote.disconnect();
  }, [session]);

  if (!session) {
    return (
      <PairingScanner
        onPair={(payload) => {
          setSnapshot({ status: "connecting", state: null, message: "Connecting..." });
          setScannedSession({ sessionId: payload.sessionId, token: payload.controllerToken, source: "scan" });
        }}
      />
    );
  }

  if (snapshot.status === "auth-failed" && session.source === "scan") {
    return <ScanAgain message="This ChromeRemote pairing session has expired. Create a new QR from the Chrome extension." onScanAgain={() => setScannedSession(null)} />;
  }

  const runCommand = (command: PlayerCommand) => {
    void socketRef.current?.command(command);
  };

  const commitSeek = (seconds: number) => {
    setLocalSeek(null);
    runCommand({ type: "SEEK_TO", seconds });
  };

  const commitVolume = (percent: number) => {
    const nextVolume = Math.round(Math.min(Math.max(percent, 0), 100));
    setLocalVolume(null);
    runCommand({ type: "SET_VOLUME", volume: nextVolume / 100 });
  };

  const adjustVolume = (delta: number) => {
    const baseVolume = localVolume ?? Math.round((player?.volume ?? 0) * 100);
    commitVolume(baseVolume + delta);
  };

  return (
    <main className="remote-shell">
      <header className="topbar">
        <div>
          <h1>ChromeRemote</h1>
          <p>Netflix Player</p>
        </div>
        <span className={`status-pill status-${snapshot.status}`}>
          <span aria-hidden="true" />
          {snapshot.status === "connected" ? "Connected" : "Connecting"}
        </span>
      </header>

      {player?.title || player?.episode ? (
        <section className="media-details" aria-label="Now playing">
          <span>Now Playing</span>
          {player?.title ? <strong>{player.title}</strong> : null}
          {player?.episode ? <p>{player.episode}</p> : null}
        </section>
      ) : null}

      <section className="media-actions" aria-label="Netflix media actions">
        <button type="button" disabled={disabled} onClick={() => runCommand({ type: "NEXT_EPISODE" })}>
          Next Episode
        </button>
        <button type="button" disabled={disabled} onClick={() => runCommand({ type: "FULLSCREEN" })}>
          Fullscreen
        </button>
        <button type="button" disabled={disabled} onClick={() => runCommand({ type: "EXIT_FULLSCREEN" })}>
          Exit Fullscreen
        </button>
        <button type="button" disabled={disabled} onClick={() => runCommand({ type: "TOGGLE_MUTE" })}>
          {player?.muted ? "Unmute" : "Mute"}
        </button>
      </section>

      <section className="volume-panel" aria-label="Volume controls">
        <div className="volume-header">
          <span>Volume</span>
          <strong>{volume}%</strong>
        </div>
        <div className="volume-row">
          <button type="button" disabled={disabled} aria-label="Volume down" onClick={() => adjustVolume(-10)}>
            -
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            disabled={disabled}
            aria-label="Volume"
            onChange={(event) => setLocalVolume(Number(event.currentTarget.value))}
            onPointerUp={(event) => commitVolume(Number(event.currentTarget.value))}
            onKeyUp={(event) => commitVolume(Number(event.currentTarget.value))}
          />
          <button type="button" disabled={disabled} aria-label="Volume up" onClick={() => adjustVolume(10)}>
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
              onClick={() => runCommand({ type: "SET_PLAYBACK_RATE", rate: rate as PlaybackRate })}
            >
              {formatPlaybackRate(rate)}
            </button>
          ))}
        </div>
      </section>

      <footer className="state-grid" aria-label="Player status">
        <div>
          <span>Playback</span>
          <strong>{player?.playing ? "Playing" : "Paused"}</strong>
        </div>
        <div>
          <span>Speed</span>
          <strong>{formatPlaybackRate(playbackRate)}</strong>
        </div>
        <div>
          <span>Muted</span>
          <strong>{player?.muted ? "Yes" : "No"}</strong>
        </div>
      </footer>

      <section className="readout readout-bottom" aria-label="Playback position">
        <div className="time-row">
          <strong>{formatTime(progress)}</strong>
          <span>/</span>
          <strong>{formatTime(player?.duration ?? 0)}</strong>
        </div>
        <input
          type="range"
          min="0"
          max={Math.max(player?.duration ?? 0, 0)}
          value={progress}
          disabled={disabled || !player?.duration}
          aria-label="Seek"
          onChange={(event) => setLocalSeek(Number(event.currentTarget.value))}
          onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
          onKeyUp={(event) => commitSeek(Number(event.currentTarget.value))}
        />
      </section>

      <section className="controls" aria-label="Playback controls">
        <button type="button" disabled={disabled} onClick={() => runCommand({ type: "SEEK_RELATIVE", seconds: -10 })}>
          -10
        </button>
        <button
          type="button"
          className="primary-control"
          disabled={disabled}
          onClick={() => runCommand({ type: player?.playing ? "PAUSE" : "PLAY" })}
        >
          {player?.playing ? "Pause" : "Play"}
        </button>
        <button type="button" disabled={disabled} onClick={() => runCommand({ type: "SEEK_RELATIVE", seconds: 10 })}>
          +10
        </button>
      </section>
    </main>
  );
}

function PairingScanner({ onPair }: { onPair: (payload: { sessionId: string; controllerToken: string }) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const pairedRef = useRef(false);
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [message, setMessage] = useState("Scan the QR code shown in your ChromeRemote extension.");

  const cleanupCamera = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;

    const stream = videoRef.current?.srcObject;
    if (stream && "getTracks" in stream) {
      stopMediaStreamTracks(stream as MediaStream);
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => cleanupCamera, []);

  const handlePayload = (rawPayload: string) => {
    const decoded = decodePairingPayload(rawPayload);
    if (!decoded.ok) {
      setStatus("scanning");
      setMessage(invalidPairingCodeMessage);
      return false;
    }

    pairedRef.current = true;
    cleanupCamera();
    setStatus("idle");
    setMessage("Connecting...");
    onPair(decoded.payload);
    return true;
  };

  const openCamera = async () => {
    setStatus("starting");
    setMessage("Opening camera...");
    pairedRef.current = false;

    if (!window.isSecureContext) {
      setStatus("error");
      setMessage("Camera access requires HTTPS.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setMessage("No camera is available in this browser.");
      return;
    }

    try {
      cleanupCamera();
      const video = videoRef.current;
      if (!video) {
        setStatus("error");
        setMessage("Camera preview is unavailable.");
        return;
      }

      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      setStatus("scanning");
      setMessage("Point your camera at the ChromeRemote QR code.");

      controlsRef.current = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        },
        video,
        (result) => {
          if (result && !pairedRef.current) {
            handlePayload(result.getText());
          }
        }
      );
    } catch (error) {
      cleanupCamera();
      setStatus("error");
      const name = error instanceof DOMException ? error.name : "";
      setMessage(name === "NotAllowedError" ? "Camera permission was denied." : "Camera is unavailable. Tap Try Again.");
    }
  };

  return (
    <main className="remote-shell scanner-shell">
      <header className="topbar">
        <div>
          <h1>ChromeRemote</h1>
          <p>Pair with Chrome</p>
        </div>
      </header>

      <section className="scanner-panel" aria-live="polite">
        <h2>Scan ChromeRemote QR</h2>
        <p>{message}</p>
        <div className="camera-frame">
          <video ref={videoRef} muted playsInline autoPlay aria-label="Camera preview" />
          {status !== "scanning" ? <span>Camera Preview</span> : null}
        </div>
        {status === "idle" || status === "error" ? (
          <button type="button" className="primary-control" onClick={() => void openCamera()}>
            {status === "error" ? "Try Again" : "Open Camera"}
          </button>
        ) : null}
      </section>
    </main>
  );
}

function ScanAgain({ message, onScanAgain }: { message: string; onScanAgain: () => void }) {
  return (
    <main className="remote-shell scanner-shell">
      <header className="topbar">
        <div>
          <h1>ChromeRemote</h1>
          <p>Pair with Chrome</p>
        </div>
      </header>
      <section className="scanner-panel" aria-live="polite">
        <h2>Scan ChromeRemote QR</h2>
        <p>{message}</p>
        <button type="button" className="primary-control" onClick={onScanAgain}>
          Scan Again
        </button>
      </section>
    </main>
  );
}
