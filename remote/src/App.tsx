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

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => {
  detect(image: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>;
};

type WindowWithBarcodeDetector = Window &
  typeof globalThis & {
    BarcodeDetector?: BarcodeDetectorConstructor & {
      getSupportedFormats?: () => Promise<string[]>;
    };
  };

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
  const match = window.location.pathname.match(/\/r\/([^/]+)/);
  const token = window.location.hash.slice(1);
  return match && token ? { sessionId: decodeURIComponent(match[1]), token, source: "url" } : null;
}

export function App() {
  const [snapshot, setSnapshot] = useState<RemoteSnapshot>(emptySnapshot);
  const [localSeek, setLocalSeek] = useState<number | null>(null);
  const [scannedSession, setScannedSession] = useState<ControllerSession | null>(null);
  const socketRef = useRef<RemoteSocket | null>(null);
  const urlSession = useMemo(sessionFromUrl, []);
  const session = scannedSession ?? urlSession;
  const player = snapshot.state;
  const disabled = snapshot.status !== "connected" || !player?.detected;
  const progress = localSeek ?? player?.currentTime ?? 0;
  const volume = Math.round((player?.volume ?? 0) * 100);
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

      <section className="readout" aria-live="polite">
        <div className="connection-detail">{snapshot.message}</div>
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
          <button type="button" disabled={disabled} aria-label="Volume down" onClick={() => runCommand({ type: "SET_VOLUME", volume: clampVolume((player?.volume ?? 0) - 0.1) })}>
            -
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            disabled={disabled}
            aria-label="Volume"
            onChange={(event) => runCommand({ type: "SET_VOLUME", volume: Number(event.currentTarget.value) / 100 })}
          />
          <button type="button" disabled={disabled} aria-label="Volume up" onClick={() => runCommand({ type: "SET_VOLUME", volume: clampVolume((player?.volume ?? 0) + 0.1) })}>
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

      <footer className="state-grid">
        <span>Playback</span>
        <strong>{player?.playing ? "Playing" : "Paused"}</strong>
        <span>Speed</span>
        <strong>{formatPlaybackRate(playbackRate)}</strong>
        <span>Muted</span>
        <strong>{player?.muted ? "Yes" : "No"}</strong>
      </footer>

      <div className="chrome-status">
        <span aria-hidden="true" /> {snapshot.message}
      </div>
    </main>
  );
}

function PairingScanner({ onPair }: { onPair: (payload: { sessionId: string; controllerToken: string }) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pairedRef = useRef(false);
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [message, setMessage] = useState("Scan the QR code shown in your ChromeRemote extension.");

  const cleanupCamera = () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    controlsRef.current?.stop();
    controlsRef.current = null;
    if (streamRef.current) {
      stopMediaStreamTracks(streamRef.current);
      streamRef.current = null;
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

  const scanWithNativeDetector = async (video: HTMLVideoElement) => {
    const barcodeWindow = window as WindowWithBarcodeDetector;
    if (!barcodeWindow.BarcodeDetector) {
      return false;
    }

    const supportedFormats = barcodeWindow.BarcodeDetector.getSupportedFormats ? await barcodeWindow.BarcodeDetector.getSupportedFormats() : ["qr_code"];
    if (!supportedFormats.includes("qr_code")) {
      return false;
    }

    const detector = new barcodeWindow.BarcodeDetector({ formats: ["qr_code"] });
    const scanFrame = () => {
      void detector
        .detect(video)
        .then((codes) => {
          if (pairedRef.current) {
            return;
          }

          const value = codes.find((code) => typeof code.rawValue === "string")?.rawValue;
          if (value && handlePayload(value)) {
            return;
          }

          animationFrameRef.current = window.requestAnimationFrame(scanFrame);
        })
        .catch(() => {
          animationFrameRef.current = window.requestAnimationFrame(scanFrame);
        });
    };

    scanFrame();
    return true;
  };

  const scanWithZxing = async (video: HTMLVideoElement) => {
    const { BrowserQRCodeReader } = await import("@zxing/browser");
    const reader = new BrowserQRCodeReader();
    controlsRef.current = await reader.decodeFromVideoElement(video, (result) => {
      if (result && !pairedRef.current) {
        handlePayload(result.getText());
      }
    });
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        cleanupCamera();
        setStatus("error");
        setMessage("Camera preview is unavailable.");
        return;
      }

      video.srcObject = stream;
      await video.play();
      setStatus("scanning");
      setMessage("Point your camera at the ChromeRemote QR code.");

      const nativeScanning = await scanWithNativeDetector(video);
      if (!nativeScanning) {
        await scanWithZxing(video);
      }
    } catch (error) {
      cleanupCamera();
      setStatus("error");
      const name = error instanceof DOMException ? error.name : "";
      setMessage(name === "NotAllowedError" ? "Camera permission was denied." : "Camera is unavailable.");
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
          <video ref={videoRef} muted playsInline aria-label="Camera preview" />
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
