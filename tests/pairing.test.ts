import assert from "node:assert/strict";
import test from "node:test";
import { backgroundUnavailableResponse, isCreateRemoteSessionResponse, isPairingRequest, isValidRemoteOrigin } from "../src/shared/pairing.js";

test("background handler diagnostic REMOTE_PING request is recognized", () => {
  assert.equal(isPairingRequest({ type: "REMOTE_PING" }), true);
});

test("REMOTE_CONNECT_PHONE and REMOTE_DISCONNECT requests are recognized", () => {
  assert.equal(isPairingRequest({ type: "REMOTE_CONNECT_PHONE", tabId: 184, tabUrl: "https://www.netflix.com/watch/123" }), true);
  assert.equal(isPairingRequest({ type: "REMOTE_DISCONNECT" }), true);
});

test("missing server configuration can be detected", () => {
  assert.equal(isValidRemoteOrigin(""), false);
  assert.equal(isValidRemoteOrigin("http://localhost:8787"), true);
  assert.equal(isValidRemoteOrigin("ws://localhost:8787"), true);
});

test("successful session creation response is parsed", () => {
  assert.equal(
    isCreateRemoteSessionResponse({
      sessionId: "session",
      playerToken: "player",
      controllerToken: "controller",
      remoteUrl: "http://localhost:5174/r/session#controller",
      expiresAt: new Date(Date.now() + 1000).toISOString()
    }),
    true
  );
});

test("malformed session response is rejected", () => {
  assert.equal(isCreateRemoteSessionResponse({ sessionId: "session" }), false);
  assert.equal(
    isCreateRemoteSessionResponse({
      sessionId: "session",
      playerToken: "player",
      controllerToken: "controller",
      remoteUrl: "http://localhost:5174/r/session#controller",
      expiresAt: "not-a-date"
    }),
    false
  );
});

test("popup rejected runtime messaging maps to background unavailable", () => {
  const response = backgroundUnavailableResponse();
  assert.equal(response.ok, false);
  assert.equal(response.ok ? "" : response.errorCode, "BACKGROUND_UNAVAILABLE");
  assert.match(response.ok ? "" : response.error, /background service is unavailable/i);
});
