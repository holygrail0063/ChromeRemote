import { isPlayerCommand, type PlayerCommand } from "./messages.js";
import type { PlayerState } from "./player-state.js";

export type RemoteRole = "player" | "controller";

export type RemoteErrorCode =
  | "AUTH_FAILED"
  | "CONTROLLER_ALREADY_CONNECTED"
  | "DESKTOP_DISCONNECTED"
  | "EXPIRED"
  | "FULLSCREEN_REQUIRES_USER_GESTURE"
  | "INVALID_MESSAGE"
  | "PLAYER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "SESSION_ENDED"
  | "UNAUTHENTICATED"
  | "UNSUPPORTED_COMMAND";

export type RemoteClientMessage =
  | { type: "AUTH"; role: RemoteRole; sessionId: string; token: string }
  | { type: "COMMAND"; requestId: string; command: PlayerCommand }
  | { type: "PLAYER_STATE"; state: PlayerState }
  | { type: "COMMAND_RESULT"; requestId: string; ok: true; state?: PlayerState }
  | { type: "COMMAND_RESULT"; requestId: string; ok: false; errorCode: RemoteErrorCode; message: string; state?: PlayerState }
  | { type: "PING" };

export type RemoteServerMessage =
  | { type: "AUTH_OK"; role: RemoteRole; expiresAt: string }
  | { type: "AUTH_FAILED"; errorCode: RemoteErrorCode; message: string }
  | { type: "COMMAND"; requestId: string; command: PlayerCommand }
  | { type: "COMMAND_RESULT"; requestId: string; ok: true; state?: PlayerState }
  | { type: "COMMAND_RESULT"; requestId: string; ok: false; errorCode: RemoteErrorCode; message: string; state?: PlayerState }
  | { type: "PLAYER_STATE"; state: PlayerState }
  | { type: "CONTROLLER_CONNECTED" }
  | { type: "CONTROLLER_DISCONNECTED" }
  | { type: "DESKTOP_DISCONNECTED" }
  | { type: "SESSION_EXPIRED" }
  | { type: "SESSION_ENDED" }
  | { type: "PONG" };

export const MAX_REMOTE_MESSAGE_BYTES = 16 * 1024;

const REMOTE_COMMAND_TYPES = new Set<PlayerCommand["type"]>([
  "GET_STATE",
  "PLAY",
  "PAUSE",
  "SEEK_RELATIVE",
  "SEEK_TO",
  "SET_VOLUME",
  "TOGGLE_MUTE",
  "SET_PLAYBACK_RATE",
  "NEXT_EPISODE",
  "FULLSCREEN",
  "EXIT_FULLSCREEN"
]);

export function isRemoteCommand(command: unknown): command is PlayerCommand {
  if (!isPlayerCommand(command)) {
    return false;
  }

  const playerCommand = command as PlayerCommand;
  if (playerCommand.type === "SET_VOLUME") {
    return playerCommand.volume >= 0 && playerCommand.volume <= 1;
  }

  return REMOTE_COMMAND_TYPES.has(playerCommand.type);
}

export function parseRemoteMessage(raw: string): unknown {
  if (new TextEncoder().encode(raw).byteLength > MAX_REMOTE_MESSAGE_BYTES) {
    throw new Error("Remote message is too large.");
  }

  return JSON.parse(raw) as unknown;
}

export function isRemoteClientMessage(message: unknown): message is RemoteClientMessage {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as Record<string, unknown>;
  if (candidate.type === "AUTH") {
    return (
      (candidate.role === "player" || candidate.role === "controller") &&
      typeof candidate.sessionId === "string" &&
      typeof candidate.token === "string"
    );
  }

  if (candidate.type === "COMMAND") {
    return typeof candidate.requestId === "string" && isRemoteCommand(candidate.command);
  }

  if (candidate.type === "PLAYER_STATE") {
    return Boolean(candidate.state && typeof candidate.state === "object");
  }

  if (candidate.type === "COMMAND_RESULT") {
    if (typeof candidate.requestId !== "string" || typeof candidate.ok !== "boolean") {
      return false;
    }

    if (candidate.ok) {
      return true;
    }

    return typeof candidate.errorCode === "string" && typeof candidate.message === "string";
  }

  return candidate.type === "PING";
}

export function toRemoteErrorCode(errorCode?: string): RemoteErrorCode {
  if (errorCode === "FULLSCREEN_REQUIRES_USER_GESTURE") {
    return "FULLSCREEN_REQUIRES_USER_GESTURE";
  }

  return "PLAYER_UNAVAILABLE";
}
