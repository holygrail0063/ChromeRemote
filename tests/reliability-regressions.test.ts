import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("player-only fullscreen expands site player shells instead of the raw video element", () => {
  const fullscreen = source("src/content/player-fullscreen.ts");

  assert.match(fullscreen, /getYouTubePlayerRoot/);
  assert.match(fullscreen, /#movie_player, \.html5-video-player/);
  assert.match(fullscreen, /getNetflixPlayerRoot/);
  assert.match(fullscreen, /enterViewportFullscreen\(root\)/);
  assert.doesNotMatch(fullscreen, /PLAYER_FULLSCREEN_OVERLAY_ID/);
  assert.doesNotMatch(fullscreen, /video\.\$\{PLAYER_FULLSCREEN_CLASS\}/);
  assert.doesNotMatch(fullscreen, /requestFullscreen\(/);
});

test("Netflix Next Episode never seeks the current episode to its end", () => {
  const nextEpisode = source("src/netflix/next-episode.ts");

  assert.match(nextEpisode, /playNextEpisode/);
  assert.match(nextEpisode, /next-episode-seamless-button-draining/);
  assert.match(nextEpisode, /tryRenderedNextEpisode/);
  assert.doesNotMatch(nextEpisode, /\.seek\(/);
  assert.doesNotMatch(nextEpisode, /getDuration/);
});

test("phone remote keeps an active state-sync watchdog after the first player state", () => {
  const socket = source("remote/src/socket.ts");

  assert.match(socket, /stateSyncIntervalMs = 500/);
  assert.match(socket, /requestStateNow\(\)/);
  assert.match(socket, /setInterval\(\(\) => this\.requestStateNow\(\), stateSyncIntervalMs\)/);
  assert.match(socket, /lastState/);
  assert.doesNotMatch(socket, /hasPlayerState/);

  const playerStateBlock = socket.match(/if \(message\.type === "PLAYER_STATE"\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.doesNotMatch(playerStateBlock, /stopStateSync/);
});

test("Chrome-wide session routing remains active-tab based", () => {
  const background = source("src/background/background.ts");

  assert.match(background, /lastFocusedWindow: true/);
  assert.match(background, /sendCommandToActiveTab/);
  assert.match(background, /chrome\.tabs\.onActivated/);
  assert.doesNotMatch(background, /storedPairing\.pairedTabId/);
});
