import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticate,
  clearSessionsForTests,
  createSession,
  forwardFromController,
  getSession,
  invalidateSession,
  type SessionConnection
} from "../server/src/sessions.js";

function connection(id: string): SessionConnection & { messages: unknown[]; closed: boolean } {
  return {
    id,
    role: "controller",
    messages: [],
    closed: false,
    send(message: unknown) {
      this.messages.push(message);
    },
    close() {
      this.closed = true;
    }
  };
}

test("authenticates valid player and controller tokens", () => {
  clearSessionsForTests();
  const tokens = createSession();
  const player = connection("player");
  const controller = connection("controller");

  assert.equal(authenticate(tokens.sessionId, "player", tokens.playerToken, player).ok, true);
  assert.equal(authenticate(tokens.sessionId, "controller", tokens.controllerToken, controller).ok, true);
});

test("rejects invalid player and controller auth", () => {
  clearSessionsForTests();
  const tokens = createSession();

  assert.equal(authenticate(tokens.sessionId, "player", "bad-token", connection("player")).ok, false);
  assert.equal(authenticate(tokens.sessionId, "controller", "bad-token", connection("controller")).ok, false);
});

test("rejects a second simultaneous controller", () => {
  clearSessionsForTests();
  const tokens = createSession();

  assert.equal(authenticate(tokens.sessionId, "controller", tokens.controllerToken, connection("controller-1")).ok, true);
  const second = authenticate(tokens.sessionId, "controller", tokens.controllerToken, connection("controller-2"));
  assert.equal(second.ok, false);
  assert.equal(second.ok ? "" : second.errorCode, "CONTROLLER_ALREADY_CONNECTED");
});

test("rejects controller commands before a desktop player is connected", () => {
  clearSessionsForTests();
  const tokens = createSession();
  const auth = authenticate(tokens.sessionId, "controller", tokens.controllerToken, connection("controller"));
  assert.equal(auth.ok, true);

  const result = auth.ok ? forwardFromController(auth.session, { type: "COMMAND", requestId: "1", command: { type: "PLAY" } }) : null;
  assert.equal(result?.ok, false);
  assert.equal(result?.ok ? "" : result?.errorCode, "DESKTOP_DISCONNECTED");
});

test("rejects unsupported controller commands", () => {
  clearSessionsForTests();
  const tokens = createSession();
  const player = connection("player");
  const auth = authenticate(tokens.sessionId, "player", tokens.playerToken, player);
  assert.equal(auth.ok, true);

  const result = auth.ok ? forwardFromController(auth.session, { type: "COMMAND", requestId: "1", command: { type: "SET_VOLUME", volume: 2 } }) : null;
  assert.equal(result?.ok, false);
  assert.equal(result?.ok ? "" : result?.errorCode, "UNSUPPORTED_COMMAND");
});

test("expired sessions cannot authenticate", () => {
  clearSessionsForTests();
  const tokens = createSession(Date.now() - 5 * 60 * 60 * 1000);
  assert.equal(authenticate(tokens.sessionId, "player", tokens.playerToken, connection("player")).ok, false);
});

test("disconnect invalidates a session", () => {
  clearSessionsForTests();
  const tokens = createSession();
  assert.ok(getSession(tokens.sessionId));
  assert.equal(invalidateSession(tokens.sessionId), true);
  assert.equal(getSession(tokens.sessionId), null);
});

test("session remote URL uses supplied public origin", () => {
  clearSessionsForTests();
  const tokens = createSession(Date.now(), "https://chromeremote-production.up.railway.app/");
  assert.equal(tokens.remoteUrl.startsWith("https://chromeremote-production.up.railway.app/r/"), true);
  assert.equal(tokens.remoteUrl.includes("#"), true);
});
