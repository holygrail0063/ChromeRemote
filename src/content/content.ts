import { NetflixPlayer } from "../netflix/player";
import { isPlayerCommand, type PlayerCommand, type PlayerResponse } from "../shared/messages";
import { clampSeekSeconds } from "../shared/seek-utils";
import { requestNetflixAdapter } from "./netflix-seek-bridge";

const player = new NetflixPlayer();

function getSeekTargetSeconds(command: Extract<PlayerCommand, { type: "SEEK_RELATIVE" | "SEEK_TO" }>): number {
  const state = player.getState();
  if (!state.detected) {
    throw new Error("No Netflix video element detected.");
  }

  if (command.type === "SEEK_TO") {
    return clampSeekSeconds(command.seconds, state.duration);
  }

  return clampSeekSeconds(state.currentTime + command.seconds, state.duration);
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
        await requestNetflixAdapter("SEEK_RELATIVE", getSeekTargetSeconds(command));
        break;
      case "SEEK_TO":
        await requestNetflixAdapter("SEEK_TO", getSeekTargetSeconds(command));
        break;
      case "SET_VOLUME":
        player.setVolume(command.volume);
        break;
      case "SET_PLAYBACK_RATE":
        player.setPlaybackRate(command.rate);
        break;
      case "NEXT_EPISODE":
        await requestNetflixAdapter("NEXT_EPISODE");
        break;
      case "FULLSCREEN":
        await requestNetflixAdapter("FULLSCREEN");
        break;
      case "EXIT_FULLSCREEN":
        await requestNetflixAdapter("EXIT_FULLSCREEN");
        break;
      case "TOGGLE_MUTE":
        player.toggleMute();
        break;
    }

    return { ok: true, state: player.getState() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to control Netflix player.",
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
