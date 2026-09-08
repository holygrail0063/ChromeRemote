import type { PlayerCommand } from "../../src/shared/messages";
import type { PlayerState } from "../../src/shared/player-state";
import { parseRemoteMessage, type RemoteServerMessage } from "../../src/shared/remote-protocol";

export type RemoteStatus =
  | "connecting"
  | "connected"
  | "player-loading"
  | "player-unavailable"
  | "desktop-disconnected"
  | "session-expired"
  | "auth-failed";

export type RemoteSnapshot = {
  status: RemoteStatus;
  state: PlayerState | null;
  message: string;
};

function getRemoteWsOrigin(): string {
  if (import.meta.env.VITE_REMOTE_WS_ORIGIN) {
    return import.meta.env.VITE_REMOTE_WS_ORIGIN;
  }

  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
}

function routeFullscreenCommand(command: PlayerCommand): PlayerCommand {
  if (command.type === "FULLSCREEN") {
    return { type: "ENTER_PLAYER_FULLSCREEN" };
  }

  if (command.type === "EXIT_FULLSCREEN") {
    return { type: "EXIT_PLAYER_FULLSCREEN" };
  }

  return command;
}

const remoteWsOrigin = getRemoteWsOrigin();
const stateSyncIntervalMs = 500;
const reconnectDelaysMs = [500, 1000, 2000, 5000];

export class RemoteSocket {
  private socket: WebSocket | null = null;
  private pending = new Map<string, (ok: boolean) => void>();
  private reconnectTimer: number | null = null;
  private stateSyncTimer: number | null = null;
  private manuallyClosed = false;
  private reconnectAttempt = 0;
  private lastState: PlayerState | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly controllerToken: string,
    private readonly onSnapshot: (snapshot: RemoteSnapshot) => void
  ) {}

  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.manuallyClosed = false;
    this.stopStateSync();
    this.onSnapshot({ status: "connecting", state: this.lastState, message: "Connecting to Chrome..." });
    this.socket = new WebSocket(`${remoteWsOrigin}/ws`);

    this.socket.addEventListener("open", () => {
      this.sendRaw({ type: "AUTH", role: "controller", sessionId: this.sessionId, token: this.controllerToken });
    });

    this.socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    this.socket.addEventListener("close", () => {
      this.socket = null;
      this.stopStateSync();
      this.resolvePending(false);
      if (!this.manuallyClosed) {
        this.onSnapshot({ status: "desktop-disconnected", state: this.lastState, message: "ChromeRemote disconnected. Reconnecting..." });
        this.scheduleReconnect();
      }
    });
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.stopStateSync();
    this.clearReconnectTimer();
    this.resolvePending(false);
    this.socket?.close();
  }

  endSession(): void {
    this.manuallyClosed = true;
    this.stopStateSync();
    this.clearReconnectTimer();
    this.sendRaw({ type: "END_SESSION" });
  }

  command(command: PlayerCommand): Promise<boolean> {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.resolve(false);
    }

    const requestId = crypto.randomUUID();
    this.sendRaw({ type: "COMMAND", requestId, command: routeFullscreenCommand(command) });
    return new Promise((resolve) => this.pending.set(requestId, resolve));
  }

  requestStateNow(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    const requestId = `state-${crypto.randomUUID()}`;
    this.sendRaw({ type: "COMMAND", requestId, command: { type: "GET_STATE" } });
  }

  private startStateSync(): void {
    this.stopStateSync();
    this.requestStateNow();
    this.stateSyncTimer = window.setInterval(() => this.requestStateNow(), stateSyncIntervalMs);
  }

  private stopStateSync(): void {
    if (this.stateSyncTimer !== null) {
      window.clearInterval(this.stateSyncTimer);
      this.stateSyncTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || this.reconnectTimer !== null) {
      return;
    }

    const delay = reconnectDelaysMs[Math.min(this.reconnectAttempt, reconnectDelaysMs.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private resolvePending(ok: boolean): void {
    for (const resolve of this.pending.values()) {
      resolve(ok);
    }
    this.pending.clear();
  }

  private snapshotFromState(state: PlayerState, message?: string): void {
    this.lastState = state;
    this.onSnapshot({
      status: state.detected ? "connected" : "player-loading",
      state,
      message: message ?? (state.detected ? "Connected" : "Waiting for the active player...")
    });
  }

  private handleMessage(raw: string): void {
    const message = parseRemoteMessage(raw) as RemoteServerMessage;

    if (message.type === "AUTH_OK") {
      this.reconnectAttempt = 0;
      this.clearReconnectTimer();
      this.onSnapshot({ status: "connecting", state: this.lastState, message: "Syncing active player..." });
      this.startStateSync();
      return;
    }

    if (message.type === "AUTH_FAILED") {
      this.stopStateSync();
      this.onSnapshot({ status: "auth-failed", state: this.lastState, message: message.message });
      this.disconnect();
      return;
    }

    if (message.type === "PLAYER_STATE") {
      this.snapshotFromState(message.state);
      return;
    }

    if (message.type === "COMMAND_RESULT") {
      this.pending.get(message.requestId)?.(message.ok);
      this.pending.delete(message.requestId);

      if (message.state) {
        this.lastState = message.state;
      }

      if (!message.ok) {
        this.onSnapshot({
          status: message.errorCode === "PLAYER_UNAVAILABLE" ? "player-unavailable" : "connecting",
          state: message.state ?? this.lastState,
          message: message.message
        });
      } else if (message.state) {
        this.snapshotFromState(message.state, message.state.detected ? "Connected" : "Waiting for the active player...");
      }
      return;
    }

    if (message.type === "DESKTOP_DISCONNECTED") {
      this.onSnapshot({ status: "desktop-disconnected", state: this.lastState, message: "ChromeRemote desktop is reconnecting..." });
      return;
    }

    if (message.type === "SESSION_EXPIRED") {
      this.stopStateSync();
      this.onSnapshot({ status: "session-expired", state: this.lastState, message: "This remote session has expired." });
      this.disconnect();
      return;
    }

    if (message.type === "SESSION_ENDED") {
      this.stopStateSync();
      this.onSnapshot({ status: "session-expired", state: this.lastState, message: "This remote session has ended." });
      this.disconnect();
    }
  }

  private sendRaw(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
