import assert from "node:assert/strict";
import test from "node:test";
import { isPlayerCommand } from "../src/shared/messages.js";

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
