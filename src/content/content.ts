import { NetflixPlayer } from "../netflix/player";
import { isPlayerCommand, type PlayerCommand, type PlayerResponse } from "../shared/messages";
import { clampSeekSeconds } from "../shared/seek-utils";
import { seekYouTubeTo } from "../youtube/player";
import { requestNetflixAdapter } from "./netflix-seek-bridge";

const player = new NetflixPlayer();

function isYouTubePage(): boolean {
  return window.location.hostname.includes("youtube.com");
}

function getSeekTargetSeconds(command: Extract<PlayerCommand, { type: "SEEK_RELATIVE" | "SEEK_TO" }>): number {
  const state = player.getState();
  if (!state.detected) {
    throw new Error(`No ${isYouTubePage() ? "YouTube" : "Netflix"} video element detected.`);
  }

  if (command.type === "SEEK_TO") {
    return clampSeekSeconds(command.seconds, state.duration);
  }

  return clampSeekSeconds(state.currentTime + command.seconds, state.duration);
}

function searchYouTube(query: string): void {
  if (!isYouTubePage()) {
    throw new Error("YouTube search is only available on a paired YouTube tab.");
  }

  const trimmedQuery = query.trim();
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(trimmedQuery)}`;

  // Let the command response reach the phone before navigation replaces the page.
  window.setTimeout(() => window.location.assign(searchUrl), 50);
}

async function handleCommand(command: PlayerCommand): Promise<PlayerResponse> {
  try {
    switch (command.type) {
      case "GET_STATE":
        break;
      case "PLAY":
        await player.play();
        break;
      case "PAUSE":
        player.pause();
        break;
      case "SEEK_RELATIVE":
      case "SEEK_TO": {
        const targetSeconds = getSeekTargetSeconds(command);
        if (isYouTubePage()) {
          seekYouTubeTo(targetSeconds);
        } else {
          await requestNetflixAdapter(command.type, targetSeconds);
        }
        break;
      }
      case "SET_VOLUME":
        player.setVolume(command.volume);
        break;
      case "SET_PLAYBACK_RATE":
        player.setPlaybackRate(command.rate);
        break;
      case "NEXT_EPISODE":
        if (isYouTubePage()) {
          player.nextYouTubeVideo();
        } else {
          await requestNetflixAdapter("NEXT_EPISODE");
        }
        break;
      case "FULLSCREEN":
        if (!isYouTubePage()) {
          await requestNetflixAdapter("FULLSCREEN");
        }
        break;
      case "EXIT_FULLSCREEN":
        if (!isYouTubePage()) {
          await requestNetflixAdapter("EXIT_FULLSCREEN");
        }
        break;
      case "TOGGLE_MUTE":
        player.toggleMute();
        break;
      case "SEARCH_YOUTUBE":
        searchYouTube(command.query);
        break;
    }

    return { ok: true, state: player.getState() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : `Unable to control ${isYouTubePage() ? "YouTube" : "Netflix"} player.`,
      errorCode: error instanceof Error && error.name !== "Error" ? error.name : undefined,
      state: player.getState()
    };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (response: PlayerResponse) => void) => {
  if (!isPlayerCommand(message)) {
    sendResponse({ ok: false, error: "Unsupported ChromeRemote command.", state: player.getState() });
    return false;
  }

  void handleCommand(message).then(sendResponse);
  return true;
});
