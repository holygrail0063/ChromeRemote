import assert from "node:assert/strict";
import test from "node:test";
import {
  backgroundUnavailableResponse,
  decodePairingPayload,
  encodePairingPayload,
  isCreateRemoteSessionResponse,
  isPairingRequest,
  isValidRemoteOrigin,
  stopMediaStreamTracks,
  validateControllerUrl
} from "../src/shared/pairing.js";

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

test("production controller URL validation rejects local and malformed phone links", () => {
  assert.equal(validateControllerUrl("https://chromeremote-production.up.railway.app/r/session#controller", true).ok, true);
  assert.equal(validateControllerUrl("http://localhost:8787/r/session#controller", true).ok, false);
  assert.equal(validateControllerUrl("http://127.0.0.1:8787/r/session#controller", true).ok, false);
  assert.equal(validateControllerUrl("https://chromeremote-production.up.railway.app/r/session?token=controller", true).ok, false);
  assert.equal(validateControllerUrl("https://chromeremote-production.up.railway.app/browse#controller", true).ok, false);
});

test("development controller URL validation permits localhost phone links", () => {
  assert.equal(validateControllerUrl("http://localhost:8787/r/session#controller", false).ok, true);
});

test("pairing payload round trips valid CR1 payloads", () => {
  const rawPayload = encodePairingPayload("session_123456", "controller-token_123456");
  assert.equal(rawPayload, "CR1:session_123456:controller-token_123456");

  const decoded = decodePairingPayload(rawPayload);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.ok ? decoded.payload : null, {
    sessionId: "session_123456",
    controllerToken: "controller-token_123456"
  });
});

test("pairing payload rejects wrong protocol version", () => {
  assert.equal(decodePairingPayload("CR2:session_123456:controller-token_123456").ok, false);
});

test("pairing payload rejects missing session id", () => {
  assert.equal(decodePairingPayload("CR1::controller-token_123456").ok, false);
});

test("pairing payload rejects missing token", () => {
  assert.equal(decodePairingPayload("CR1:session_123456:").ok, false);
});

test("pairing payload rejects malformed QR data", () => {
  assert.equal(decodePairingPayload("https://example.com/not-chromeremote").ok, false);
  assert.equal(decodePairingPayload("CR1:session:token:extra").ok, false);
});

test("camera cleanup helper stops every media stream track", () => {
  const stopped: string[] = [];
  stopMediaStreamTracks({
    getTracks: () => [
      { stop: () => stopped.push("video") },
      { stop: () => stopped.push("audio") }
    ]
  });

  assert.deepEqual(stopped, ["video", "audio"]);
});
