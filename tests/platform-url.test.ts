import assert from "node:assert/strict";
import test from "node:test";
import { getNetflixPageContext } from "../src/shared/netflix-url.js";

test("detects Netflix playback pages", () => {
  const context = getNetflixPageContext("https://www.netflix.com/watch/12345");
  assert.equal(context.site, "netflix");
  assert.equal(context.isPlaybackPage, true);
  assert.equal(context.isWatchPage, true);
});

test("detects YouTube playback pages", () => {
  const context = getNetflixPageContext("https://www.youtube.com/watch?v=abc123");
  assert.equal(context.site, "youtube");
  assert.equal(context.isPlaybackPage, true);
  assert.equal(context.isWatchPage, true);
});

test("keeps YouTube search pages valid for an existing paired session", () => {
  const context = getNetflixPageContext("https://www.youtube.com/results?search_query=music");
  assert.equal(context.site, "youtube");
  assert.equal(context.isYouTube, true);
  assert.equal(context.isPlaybackPage, false);
  assert.equal(context.isWatchPage, true);
});

test("does not keep Netflix browse pages valid as playback pages", () => {
  const context = getNetflixPageContext("https://www.netflix.com/browse");
  assert.equal(context.site, "netflix");
  assert.equal(context.isPlaybackPage, false);
  assert.equal(context.isWatchPage, false);
});
