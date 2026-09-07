import { NetflixPlayer } from "../netflix/player";
import { isPlayerCommand, type PlayerCommand, type PlayerResponse } from "../shared/messages";
import { clampSeekSeconds } from "../shared/seek-utils";
import { seekYouTubeTo } from "../youtube/player";
import { requestNetflixAdapter } from "./netflix-seek-bridge";
import { enterNetflixPlayerFullscreen, enterYouTubePlayerFullscreen, exitPlayerFullscreen } from "./player-fullscreen";

const player = new NetflixPlayer();
const youtubeSelectionClass = "chromeremote-youtube-selected-result";
const youtubeSelectionStyleId = "chromeremote-youtube-selection-style";
let selectedYouTubeResultHref: string | null = null;

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

function ensureYouTubeSelectionStyle(): void {
  if (document.getElementById(youtubeSelectionStyleId)) {
    return;
  }

  const style = document.createElement("style");
  style.id = youtubeSelectionStyleId;
  style.textContent = `
    .${youtubeSelectionClass} {
      outline: 4px solid #ff3d57 !important;
      outline-offset: 6px !important;
      border-radius: 12px !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function getYouTubeResultLinks(): HTMLAnchorElement[] {
  const seen = new Set<string>();
  const links: HTMLAnchorElement[] = [];

  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a#video-title[href*="/watch?v="]'))) {
    const href = link.href;
    if (!href || seen.has(href)) {
      continue;
    }

    seen.add(href);
    links.push(link);
  }

  return links;
}

function getYouTubeResultContainer(link: HTMLAnchorElement): HTMLElement {
  return (
    link.closest<HTMLElement>("ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer") ??
    link
  );
}

function selectYouTubeResult(link: HTMLAnchorElement): void {
  ensureYouTubeSelectionStyle();
  document.querySelectorAll(`.${youtubeSelectionClass}`).forEach((element) => element.classList.remove(youtubeSelectionClass));

  selectedYouTubeResultHref = link.href;
  const container = getYouTubeResultContainer(link);
  container.classList.add(youtubeSelectionClass);
  container.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  link.focus({ preventScroll: true });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function moveYouTubeResultSelection(direction: -1 | 1): Promise<void> {
  if (!isYouTubePage()) {
    throw new Error("YouTube result navigation is only available on a paired YouTube tab.");
  }

  let links = getYouTubeResultLinks();
  if (links.length === 0) {
    window.scrollBy({ top: direction * Math.max(window.innerHeight * 0.8, 400), behavior: "smooth" });
    await delay(350);
    links = getYouTubeResultLinks();
  }

  if (links.length === 0) {
    throw new Error("No YouTube video results are available yet.");
  }

  let currentIndex = selectedYouTubeResultHref ? links.findIndex((link) => link.href === selectedYouTubeResultHref) : -1;
  let nextIndex = currentIndex < 0 ? 0 : currentIndex + direction;

  if (nextIndex >= links.length) {
    window.scrollBy({ top: Math.max(window.innerHeight * 0.8, 400), behavior: "smooth" });
    await delay(400);
    links = getYouTubeResultLinks();
    currentIndex = selectedYouTubeResultHref ? links.findIndex((link) => link.href === selectedYouTubeResultHref) : -1;
    nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, links.length - 1);
  }

  if (nextIndex < 0) {
    window.scrollBy({ top: -Math.max(window.innerHeight * 0.8, 400), behavior: "smooth" });
    await delay(300);
    links = getYouTubeResultLinks();
    currentIndex = selectedYouTubeResultHref ? links.findIndex((link) => link.href === selectedYouTubeResultHref) : -1;
    nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
  }

  selectYouTubeResult(links[Math.min(Math.max(nextIndex, 0), links.length - 1)]);
}

function openSelectedYouTubeResult(): void {
  if (!isYouTubePage()) {
    throw new Error("YouTube result navigation is only available on a paired YouTube tab.");
  }

  const links = getYouTubeResultLinks();
  const selected = selectedYouTubeResultHref ? links.find((link) => link.href === selectedYouTubeResultHref) : undefined;
  const link = selected ?? links[0];
  if (!link) {
    throw new Error("No YouTube video result is selected.");
  }

  selectYouTubeResult(link);
  window.setTimeout(() => link.click(), 50);
}

function searchYouTube(query: string): void {
  if (!isYouTubePage()) {
    throw new Error("YouTube search is only available on a paired YouTube tab.");
  }

  const trimmedQuery = query.trim();
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(trimmedQuery)}`;
  selectedYouTubeResultHref = null;

  // Let the command response reach the phone before navigation replaces the page.
  window.setTimeout(() => window.location.assign(searchUrl), 50);
}

async function enterRemotePlayerFullscreen(): Promise<void> {
  if (isYouTubePage()) {
    await enterYouTubePlayerFullscreen();
    return;
  }

  await enterNetflixPlayerFullscreen(() => requestNetflixAdapter("FULLSCREEN"));
}

async function exitRemotePlayerFullscreen(): Promise<void> {
  if (isYouTubePage()) {
    await exitPlayerFullscreen();
    return;
  }

  await exitPlayerFullscreen(() => requestNetflixAdapter("EXIT_FULLSCREEN"));
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
      case "ENTER_PLAYER_FULLSCREEN":
        await enterRemotePlayerFullscreen();
        break;
      case "EXIT_FULLSCREEN":
      case "EXIT_PLAYER_FULLSCREEN":
        await exitRemotePlayerFullscreen();
        break;
      case "TOGGLE_MUTE":
        player.toggleMute();
        break;
      case "SEARCH_YOUTUBE":
        searchYouTube(command.query);
        break;
      case "YOUTUBE_PREVIOUS_RESULT":
        await moveYouTubeResultSelection(-1);
        break;
      case "YOUTUBE_NEXT_RESULT":
        await moveYouTubeResultSelection(1);
        break;
      case "YOUTUBE_OPEN_SELECTED_RESULT":
        openSelectedYouTubeResult();
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
