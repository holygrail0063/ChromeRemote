import assert from "node:assert/strict";
import test from "node:test";
import { isPlayerCommand, MAX_YOUTUBE_SEARCH_LENGTH } from "../src/shared/messages.js";

test("accepts only supported playback rates", () => {
  for (const rate of [0.5, 0.75, 1, 1.25, 1.5]) {
    assert.equal(isPlayerCommand({ type: "SET_PLAYBACK_RATE", rate }), true);
  }

  for (const rate of [0, 0.8, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(isPlayerCommand({ type: "SET_PLAYBACK_RATE", rate }), false);
  }
});

test("accepts next episode and fullscreen commands", () => {
  assert.equal(isPlayerCommand({ type: "NEXT_EPISODE" }), true);
  assert.equal(isPlayerCommand({ type: "FULLSCREEN" }), true);
  assert.equal(isPlayerCommand({ type: "EXIT_FULLSCREEN" }), true);
});

test("validates YouTube search commands", () => {
  assert.equal(isPlayerCommand({ type: "SEARCH_YOUTUBE", query: "lofi music" }), true);
  assert.equal(isPlayerCommand({ type: "SEARCH_YOUTUBE", query: "   jazz   " }), true);
  assert.equal(isPlayerCommand({ type: "SEARCH_YOUTUBE", query: "" }), false);
  assert.equal(isPlayerCommand({ type: "SEARCH_YOUTUBE", query: "   " }), false);
  assert.equal(isPlayerCommand({ type: "SEARCH_YOUTUBE", query: "x".repeat(MAX_YOUTUBE_SEARCH_LENGTH + 1) }), false);
  assert.equal(isPlayerCommand({ type: "SEARCH_YOUTUBE", query: 123 }), false);
});
