import type { PlayerState } from "./player-state.js";

export type PlayerCommand =
  | { type: "GET_STATE" }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SEEK_RELATIVE"; seconds: number }
  | { type: "SEEK_TO"; seconds: number }
  | { type: "SET_VOLUME"; volume: number }
  | { type: "SET_PLAYBACK_RATE"; rate: PlaybackRate }
  | { type: "NEXT_EPISODE" }
  | { type: "FULLSCREEN" }
  | { type: "EXIT_FULLSCREEN" }
  | { type: "TOGGLE_MUTE" }
  | { type: "SEARCH_YOUTUBE"; query: string }
  | { type: "YOUTUBE_PREVIOUS_RESULT" }
  | { type: "YOUTUBE_NEXT_RESULT" }
  | { type: "YOUTUBE_OPEN_SELECTED_RESULT" };

export type PlaybackRate = 0.5 | 0.75 | 1 | 1.25 | 1.5;

export const PLAYBACK_RATES: readonly PlaybackRate[] = [0.5, 0.75, 1, 1.25, 1.5];
export const MAX_YOUTUBE_SEARCH_LENGTH = 200;

export type PlayerResponse =
  | { ok: true; state: PlayerState }
  | { ok: false; error: string; errorCode?: string; state?: PlayerState };

export const PLAYER_COMMAND_TYPES = new Set<PlayerCommand["type"]>([
  "GET_STATE",
  "PLAY",
  "PAUSE",
  "SEEK_RELATIVE",
  "SEEK_TO",
  "SET_VOLUME",
  "SET_PLAYBACK_RATE",
  "NEXT_EPISODE",
  "FULLSCREEN",
  "EXIT_FULLSCREEN",
  "TOGGLE_MUTE",
  "SEARCH_YOUTUBE",
  "YOUTUBE_PREVIOUS_RESULT",
  "YOUTUBE_NEXT_RESULT",
  "YOUTUBE_OPEN_SELECTED_RESULT"
]);

export function isPlayerCommand(message: unknown): message is PlayerCommand {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as Record<string, unknown>;
  if (typeof candidate.type !== "string" || !PLAYER_COMMAND_TYPES.has(candidate.type as PlayerCommand["type"])) {
    return false;
  }

  if (candidate.type === "SEEK_RELATIVE" || candidate.type === "SEEK_TO") {
    return typeof candidate.seconds === "number" && Number.isFinite(candidate.seconds);
  }

  if (candidate.type === "SET_VOLUME") {
    return typeof candidate.volume === "number" && Number.isFinite(candidate.volume);
  }

  if (candidate.type === "SET_PLAYBACK_RATE") {
    return typeof candidate.rate === "number" && PLAYBACK_RATES.includes(candidate.rate as PlaybackRate);
  }

  if (candidate.type === "SEARCH_YOUTUBE") {
    return (
      typeof candidate.query === "string" &&
      candidate.query.trim().length > 0 &&
      candidate.query.trim().length <= MAX_YOUTUBE_SEARCH_LENGTH
    );
  }

  return true;
}