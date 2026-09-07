import assert from "node:assert/strict";
import test from "node:test";
import { isRemoteCommand } from "../src/shared/remote-protocol.js";

test("remote protocol rejects unsupported commands", () => {
  assert.equal(isRemoteCommand({ type: "TOGGLE_PLAYBACK" }), false);
  assert.equal(isRemoteCommand({ javascript: "alert(1)" }), false);
  assert.equal(isRemoteCommand({ selector: "video" }), false);
});

test("remote protocol rejects malformed seek", () => {
  assert.equal(isRemoteCommand({ type: "SEEK_TO", seconds: Number.NaN }), false);
  assert.equal(isRemoteCommand({ type: "SEEK_RELATIVE", seconds: Number.POSITIVE_INFINITY }), false);
});

test("remote protocol rejects malformed volume", () => {
  assert.equal(isRemoteCommand({ type: "SET_VOLUME", volume: -0.1 }), false);
  assert.equal(isRemoteCommand({ type: "SET_VOLUME", volume: 1.1 }), false);
  assert.equal(isRemoteCommand({ type: "SET_VOLUME", volume: Number.NaN }), false);
  assert.equal(isRemoteCommand({ type: "SET_VOLUME", volume: 0.5 }), true);
});

test("remote protocol rejects malformed playback rate", () => {
  assert.equal(isRemoteCommand({ type: "SET_PLAYBACK_RATE", rate: 2 }), false);
  assert.equal(isRemoteCommand({ type: "SET_PLAYBACK_RATE", rate: 1.25 }), true);
});

test("remote protocol allows player fullscreen commands", () => {
  assert.equal(isRemoteCommand({ type: "ENTER_PLAYER_FULLSCREEN" }), true);
  assert.equal(isRemoteCommand({ type: "EXIT_PLAYER_FULLSCREEN" }), true);
});

test("remote protocol allows validated YouTube searches", () => {
  assert.equal(isRemoteCommand({ type: "SEARCH_YOUTUBE", query: "SQL tutorial" }), true);
  assert.equal(isRemoteCommand({ type: "SEARCH_YOUTUBE", query: "" }), false);
  assert.equal(isRemoteCommand({ type: "SEARCH_YOUTUBE", query: " ".repeat(10) }), false);
});

test("remote protocol allows YouTube result navigation", () => {
  assert.equal(isRemoteCommand({ type: "YOUTUBE_PREVIOUS_RESULT" }), true);
  assert.equal(isRemoteCommand({ type: "YOUTUBE_NEXT_RESULT" }), true);
  assert.equal(isRemoteCommand({ type: "YOUTUBE_OPEN_SELECTED_RESULT" }), true);
});
