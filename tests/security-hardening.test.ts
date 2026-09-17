import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clearSecurityStateForTests,
  consumeSessionCreationAttempt,
  MAX_SESSION_CREATIONS_PER_WINDOW,
  safeDecodePathname
} from "../server/src/security.js";
import {
  clearSessionsForTests,
  createSession,
  getActiveSessionCount,
  MAX_ACTIVE_SESSIONS,
  sweepExpiredSessions
} from "../server/src/sessions.js";
import { decodeFrames, isAllowedWebSocketOrigin } from "../server/src/websocket.js";
import { MAX_REMOTE_MESSAGE_BYTES } from "../src/shared/remote-protocol.js";

function maskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  assert.ok(payload.length < 126);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const frame = Buffer.alloc(2 + mask.length + payload.length);
  frame[0] = 0x81;
  frame[1] = 0x80 | payload.length;
  mask.copy(frame, 2);

  for (let index = 0; index < payload.length; index += 1) {
    frame[6 + index] = payload[index] ^ mask[index % 4];
  }

  return frame;
}

test("session creation is bounded globally", () => {
  clearSessionsForTests();
  const now = Date.now();

  for (let index = 0; index < MAX_ACTIVE_SESSIONS; index += 1) {
    createSession(now);
  }

  assert.equal(getActiveSessionCount(), MAX_ACTIVE_SESSIONS);
  assert.throws(() => createSession(now), /maximum number of active sessions/i);
  clearSessionsForTests();
});

test("expired sessions are swept without being touched individually", () => {
  clearSessionsForTests();
  const oldNow = Date.now() - 5 * 60 * 60 * 1000;
  createSession(oldNow);
  createSession(oldNow);
  assert.equal(getActiveSessionCount(), 2);
  assert.equal(sweepExpiredSessions(Date.now()), 2);
  assert.equal(getActiveSessionCount(), 0);
});

test("pairing session creation is rate limited per client", () => {
  clearSecurityStateForTests();
  const now = Date.now();

  for (let index = 0; index < MAX_SESSION_CREATIONS_PER_WINDOW; index += 1) {
    assert.equal(consumeSessionCreationAttempt("203.0.113.7", now + index), true);
  }

  assert.equal(consumeSessionCreationAttempt("203.0.113.7", now + 100), false);
  assert.equal(consumeSessionCreationAttempt("203.0.113.8", now + 100), true);
  clearSecurityStateForTests();
});

test("malformed percent-encoded paths are rejected safely", () => {
  assert.equal(safeDecodePathname("/%E0%A4%A", "http://localhost:8787"), null);
  assert.equal(safeDecodePathname("/remote_session", "http://localhost:8787"), "/remote_session");
});

test("WebSocket parser accepts a small masked text frame", () => {
  const decoded = decodeFrames(maskedTextFrame("{}"));
  assert.deepEqual(decoded.messages, ["{}"]);
  assert.equal(decoded.remaining.length, 0);
});

test("WebSocket parser rejects unmasked client frames", () => {
  assert.throws(() => decodeFrames(Buffer.from([0x81, 0x02, 0x7b, 0x7d])), /masked/i);
});

test("WebSocket parser rejects oversized declared frames before buffering their payload", () => {
  const frame = Buffer.alloc(4);
  frame[0] = 0x81;
  frame[1] = 0x80 | 126;
  frame.writeUInt16BE(MAX_REMOTE_MESSAGE_BYTES + 1, 2);
  assert.throws(() => decodeFrames(frame), /too large/i);
});

test("WebSocket origin policy blocks unrelated browser sites", () => {
  const allowed = ["https://chromeremote-production.up.railway.app"];
  assert.equal(isAllowedWebSocketOrigin("https://chromeremote-production.up.railway.app", allowed), true);
  assert.equal(isAllowedWebSocketOrigin("chrome-extension://abcdefghijklmnop", allowed), true);
  assert.equal(isAllowedWebSocketOrigin("https://attacker.example", allowed), false);
});

test("server source keeps critical HTTP hardening in place", () => {
  const server = readFileSync("server/src/server.ts", "utf8");
  assert.match(server, /content-security-policy/);
  assert.match(server, /x-content-type-options/);
  assert.match(server, /strict-transport-security/);
  assert.match(server, /consumeSessionCreationAttempt/);
  assert.match(server, /handleRequest\(request, response\)\.catch/);
  assert.doesNotMatch(server, /request\.method === "DELETE"/);
});
