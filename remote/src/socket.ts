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

const remoteWsOrigin = getRemoteWsOrigin();
const stateSyncIntervalMs = 750;

export class RemoteSocket {
  private socket: WebSocket | null = null;
  private pending = new Map<string, (ok: boolean) => void>();
  private reconnectTimer: number | null = null;
  private stateSyncTimer: number | null = null;
  private manuallyClosed = false;
  private hasPlayerState = false;

  constructor(
    private readonly sessionId: string,
    private readonly controllerToken: string,
    private readonly onSnapshot: (snapshot: RemoteSnapshot) => void
  ) {}

  connect(): void {
    this.manuallyClosed = false;
    this.hasPlayerState = false;
    this.stopStateSync();
    this.onSnapshot({ status: "connecting", state: null, message: "Connecting to Chrome..." });
    this.socket = new WebSocket(`${remoteWsOrigin}/ws`);

    this.socket.addEventListener("open", () => {
      this.sendRaw({ type: "AUTH", role: "controller", sessionId: this.sessionId, token: this.controllerToken });
    });

    this.socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    this.socket.addEventListener("close", () => {
      this.socket = null;
      this.stopStateSync();
      if (!this.manuallyClosed) {
        this.onSnapshot({ status: "desktop-disconnected", state: null, message: "ChromeRemote disconnected." });
        this.reconnectTimer = window.setTimeout(() => this.connect(), 2000);
      }
    });
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.stopStateSync();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
  }

  endSession(): void {
    this.manuallyClosed = true;
    this.stopStateSync();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.sendRaw({ type: "END_SESSION" });
  }

  command(command: PlayerCommand): Promise<boolean> {
    const requestId = crypto.randomUUID();
    this.sendRaw({ type: "COMMAND", requestId, command });
    return new Promise((resolve) => this.pending.set(requestId, resolve));
  }

  private startStateSync(): void {
    this.stopStateSync();

    const requestState = () => {
      if (this.hasPlayerState || this.socket?.readyState !== WebSocket.OPEN) {
        this.stopStateSync();
        return;
      }

      void this.command({ type: "GET_STATE" });
    };

    requestState();
    this.stateSyncTimer = window.setInterval(requestState, stateSyncIntervalMs);
  }

  private stopStateSync(): void {
    if (this.stateSyncTimer !== null) {
      window.clearInterval(this.stateSyncTimer);
      this.stateSyncTimer = null;
    }
  }

  private handleMessage(raw: string): void {
    const message = parseRemoteMessage(raw) as RemoteServerMessage;

    if (message.type === "AUTH_OK") {
      this.onSnapshot({ status: "connecting", state: null, message: "Syncing Netflix player..." });
      this.startStateSync();
      return;
    }

    if (message.type === "AUTH_FAILED") {
      this.stopStateSync();
      this.onSnapshot({ status: "auth-failed", state: null, message: message.message });
      this.disconnect();
      return;
    }

    if (message.type === "PLAYER_STATE") {
      this.hasPlayerState = true;
      this.stopStateSync();
      this.onSnapshot({
        status: message.state.detected ? "connected" : "player-loading",
        state: message.state,
        message: message.state.detected ? "Connected" : "Netflix player is loading..."
      });
      return;
    }

    if (message.type === "COMMAND_RESULT") {
      this.pending.get(message.requestId)?.(message.ok);
      this.pending.delete(message.requestId);
      if (!message.ok) {
        this.onSnapshot({
          status: message.errorCode === "PLAYER_UNAVAILABLE" ? "player-unavailable" : "connecting",
          state: message.state ?? null,
          message: message.message
        });
      } else if (message.state) {
        this.hasPlayerState = true;
        this.stopStateSync();
        this.onSnapshot({ status: "connected", state: message.state, message: "Connected" });
      }
      return;
    }

    if (message.type === "DESKTOP_DISCONNECTED") {
      this.stopStateSync();
      this.onSnapshot({ status: "desktop-disconnected", state: null, message: "ChromeRemote disconnected." });
      return;
    }

    if (message.type === "SESSION_EXPIRED") {
      this.stopStateSync();
      this.onSnapshot({ status: "session-expired", state: null, message: "This remote session has expired." });
      this.disconnect();
      return;
    }

    if (message.type === "SESSION_ENDED") {
      this.stopStateSync();
      this.onSnapshot({ status: "session-expired", state: null, message: "This remote session has ended." });
      this.disconnect();
    }
  }

  private sendRaw(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
