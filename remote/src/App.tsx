import { useEffect, useMemo, useRef, useState } from "react";
import { PLAYBACK_RATES, type PlaybackRate, type PlayerCommand } from "../../src/shared/messages";
import type { PlayerState } from "../../src/shared/player-state";
import { RemoteSocket, type RemoteSnapshot } from "./socket";

const emptySnapshot: RemoteSnapshot = {
  status: "connecting",
  state: null,
  message: "Connecting to Chrome..."
};

const clampVolume = (value: number) => Math.min(Math.max(value, 0), 1);
const formatPlaybackRate = (rate: number) => `${Number.isInteger(rate) ? rate.toFixed(0) : rate}x`;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function sessionFromUrl(): { sessionId: string; token: string } | null {
  const match = window.location.pathname.match(/\/r\/([^/]+)/);
  const token = window.location.hash.slice(1);
  return match && token ? { sessionId: decodeURIComponent(match[1]), token } : null;
}

export function App() {
  const [snapshot, setSnapshot] = useState<RemoteSnapshot>(emptySnapshot);
  const [localSeek, setLocalSeek] = useState<number | null>(null);
  const socketRef = useRef<RemoteSocket | null>(null);
  const session = useMemo(sessionFromUrl, []);
  const player = snapshot.state;
  const disabled = snapshot.status !== "connected" || !player?.detected;
  const progress = localSeek ?? player?.currentTime ?? 0;
  const volume = Math.round((player?.volume ?? 0) * 100);
  const playbackRate = player?.playbackRate ?? 1;

  useEffect(() => {
    if (!session) {
      setSnapshot({ status: "auth-failed", state: null, message: "Unable to authenticate this remote." });
      return;
    }

    const remote = new RemoteSocket(session.sessionId, session.token, setSnapshot);
    socketRef.current = remote;
    remote.connect();
    return () => remote.disconnect();
  }, [session]);

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
