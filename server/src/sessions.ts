import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isRemoteCommand, type RemoteErrorCode, type RemoteRole } from "../../src/shared/remote-protocol.js";

export type SessionTokens = {
  sessionId: string;
  playerToken: string;
  controllerToken: string;
  remoteUrl: string;
  expiresAt: string;
};

export type SessionConnection = {
  id: string;
  role: RemoteRole;
  send(message: unknown): void;
  close(): void;
};

export type RemoteSession = {
  sessionId: string;
  playerTokenHash: string;
  controllerTokenHash: string;
  expiresAtMs: number;
  player?: SessionConnection;
  controller?: SessionConnection;
  ended: boolean;
  recentCommandTimestamps: number[];
};

const sessionLifetimeMs = 4 * 60 * 60 * 1000;
const commandWindowMs = 1000;
const maxCommandsPerWindow = 20;
const developmentPublicOrigin = "http://localhost:8787";

const sessions = new Map<string, RemoteSession>();

type CreateSessionOptions = {
  allowLocalOrigins?: boolean;
  requireHttps?: boolean;
};

function createSecret(): string {
  return randomBytes(32).toString("base64url");
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

function secretsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isLocalPhoneOrigin(hostname: string): boolean {
  return hostname === "localhost" || hostname === [127, 0, 0, 1].join(".") || hostname === [0, 0, 0, 0].join(".");
}

export function normalizePublicOrigin(publicOrigin: string, options: CreateSessionOptions = {}): string {
  const url = new URL(publicOrigin);
  const allowLocalOrigins = options.allowLocalOrigins ?? true;

  if (!allowLocalOrigins && isLocalPhoneOrigin(url.hostname)) {
    throw new Error("PUBLIC_ORIGIN must be reachable by phones in production.");
  }

  if (options.requireHttps && url.protocol !== "https:") {
    throw new Error("PUBLIC_ORIGIN must use HTTPS in production.");
  }

  return url.origin;
}

export function createControllerUrl(sessionId: string, controllerToken: string, publicOrigin: string, options: CreateSessionOptions = {}): string {
  const origin = normalizePublicOrigin(publicOrigin, options);
  return `${origin}/r/${encodeURIComponent(sessionId)}#${controllerToken}`;
}

export function createSession(now = Date.now(), publicOrigin = developmentPublicOrigin, options: CreateSessionOptions = {}): SessionTokens {
  const sessionId = randomBytes(16).toString("base64url");
  const playerToken = createSecret();
  const controllerToken = createSecret();
  const expiresAtMs = now + sessionLifetimeMs;
  const remoteUrl = createControllerUrl(sessionId, controllerToken, publicOrigin, options);

  sessions.set(sessionId, {
    sessionId,
    playerTokenHash: hashSecret(playerToken),
    controllerTokenHash: hashSecret(controllerToken),
    expiresAtMs,
    ended: false,
    recentCommandTimestamps: []
  });

  return {
    sessionId,
    playerToken,
    controllerToken,
    remoteUrl,
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

export function getSession(sessionId: string): RemoteSession | null {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (isExpired(session)) {
    expireSession(sessionId);
    return null;
  }

  return session;
}

export function isExpired(session: RemoteSession, now = Date.now()): boolean {
  return session.ended || session.expiresAtMs <= now;
}

export function authenticate(sessionId: string, role: RemoteRole, token: string, connection: SessionConnection): { ok: true; session: RemoteSession } | { ok: false; errorCode: RemoteErrorCode; message: string } {
  const session = getSession(sessionId);
  if (!session) {
    return { ok: false, errorCode: "AUTH_FAILED", message: "Unable to authenticate this remote." };
  }

  const expectedHash = role === "player" ? session.playerTokenHash : session.controllerTokenHash;
  if (!secretsEqual(hashSecret(token), expectedHash)) {
    return { ok: false, errorCode: "AUTH_FAILED", message: "Unable to authenticate this remote." };
  }

  if (role === "controller" && session.controller && session.controller.id !== connection.id) {
    return { ok: false, errorCode: "CONTROLLER_ALREADY_CONNECTED", message: "A phone is already connected to this session." };
  }

  if (role === "player") {
    session.player = connection;
  } else {
    session.controller = connection;
    session.player?.send({ type: "CONTROLLER_CONNECTED" });
  }

  return { ok: true, session };
}

export function removeConnection(connection: SessionConnection): void {
  for (const session of sessions.values()) {
    if (session.player?.id === connection.id) {
      session.player = undefined;
      session.controller?.send({ type: "DESKTOP_DISCONNECTED" });
    }

    if (session.controller?.id === connection.id) {
      session.controller = undefined;
      session.player?.send({ type: "CONTROLLER_DISCONNECTED" });
    }
  }
}

export function forwardFromController(session: RemoteSession, message: unknown): { ok: true } | { ok: false; errorCode: RemoteErrorCode; message: string } {
  if (!session.player) {
    return { ok: false, errorCode: "DESKTOP_DISCONNECTED", message: "ChromeRemote disconnected." };
  }

  if (!message || typeof message !== "object") {
    return { ok: false, errorCode: "INVALID_MESSAGE", message: "Invalid command." };
  }

  const candidate = message as { requestId?: unknown; command?: unknown };
  if (typeof candidate.requestId !== "string" || !isRemoteCommand(candidate.command)) {
    return { ok: false, errorCode: "UNSUPPORTED_COMMAND", message: "Unsupported ChromeRemote command." };
  }

  const now = Date.now();
  session.recentCommandTimestamps = session.recentCommandTimestamps.filter((timestamp) => now - timestamp < commandWindowMs);
  if (session.recentCommandTimestamps.length >= maxCommandsPerWindow) {
    return { ok: false, errorCode: "RATE_LIMITED", message: "Too many commands." };
  }

  session.recentCommandTimestamps.push(now);
  session.player.send(message);
  return { ok: true };
}

export function forwardFromPlayer(session: RemoteSession, message: unknown): void {
  session.controller?.send(message);
}

export function expireSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  session.ended = true;
  session.player?.send({ type: "SESSION_EXPIRED" });
  session.controller?.send({ type: "SESSION_EXPIRED" });
  session.player?.close();
  session.controller?.close();
  sessions.delete(sessionId);
}

export function invalidateSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  session.ended = true;
  session.player?.send({ type: "SESSION_ENDED" });
  session.controller?.send({ type: "SESSION_ENDED" });
  session.player?.close();
  session.controller?.close();
  sessions.delete(sessionId);
  return true;
}

export function clearSessionsForTests(): void {
  sessions.clear();
}
