import assert from "node:assert/strict";
import test from "node:test";
import { clampSeekSeconds, secondsToMilliseconds } from "../src/shared/seek-utils.js";

test("converts seconds to milliseconds", () => {
  assert.equal(secondsToMilliseconds(10), 10000);
  assert.equal(secondsToMilliseconds(123.5), 123500);
});

test("clamps relative seek targets to playable range", () => {
  assert.equal(clampSeekSeconds(5 - 10, 100), 0);
  assert.equal(clampSeekSeconds(95 + 10, 100), 100);
});

test("rejects malformed seek targets", () => {
  assert.throws(() => secondsToMilliseconds(Number.NaN));
  assert.throws(() => secondsToMilliseconds(Number.POSITIVE_INFINITY));
  assert.throws(() => secondsToMilliseconds(Number.NEGATIVE_INFINITY));
  assert.throws(() => clampSeekSeconds(Number.NaN, 100));
  assert.throws(() => clampSeekSeconds(Number.POSITIVE_INFINITY, 100));
  assert.throws(() => clampSeekSeconds(Number.NEGATIVE_INFINITY, 100));
});
