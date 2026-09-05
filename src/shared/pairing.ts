export type PairingStatus =
  | "not-paired"
  | "creating"
  | "waiting"
  | "connected"
  | "temporarily-disconnected"
  | "expired";

export type PairingState = {
  status: PairingStatus;
  sessionId?: string;
  remoteUrl?: string;
  pairingPayload?: string;
  expiresAt?: string;
  pairedTabId?: number;
  errorCode?: PairingErrorCode;
  error?: string;
};

export type PairingErrorCode =
  | "BACKGROUND_UNAVAILABLE"
  | "REMOTE_SERVER_NOT_CONFIGURED"
  | "REMOTE_SERVER_UNREACHABLE"
  | "SESSION_CREATE_FAILED"
  | "SESSION_RESPONSE_INVALID"
  | "WEBSOCKET_CONNECTION_FAILED"
  | "NOT_NETFLIX_WATCH_PAGE"
  | "UNSUPPORTED_REMOTE_REQUEST";

export type PairingRequest =
  | { type: "REMOTE_PING" }
  | { type: "REMOTE_GET_STATUS" }
  | { type: "REMOTE_CONNECT_PHONE"; tabId: number; tabUrl: string }
  | { type: "REMOTE_DISCONNECT" };

export type PairingResponse =
  | { ok: true; service: "background" }
  | { ok: true; state: PairingState }
  | { ok: false; state: PairingState; error: string; errorCode: PairingErrorCode };

export type CreateRemoteSessionResponse = {
  sessionId: string;
  playerToken: string;
  controllerToken: string;
  remoteUrl: string;
  expiresAt: string;
};

export type ControllerUrlValidationResult =
  | { ok: true; url: URL }
  | { ok: false; errorCode: "REMOTE_SERVER_NOT_CONFIGURED" | "SESSION_RESPONSE_INVALID"; error: string };

export type PairingPayload = {
  sessionId: string;
  controllerToken: string;
};

export type PairingPayloadResult =
  | { ok: true; payload: PairingPayload }
  | { ok: false; error: string };

const phoneAccessConfigurationError = "ChromeRemote remote server is not configured for phone access.";
const pairingPayloadPrefix = "CR1";
const safePairingFieldPattern = /^[A-Za-z0-9_-]+$/;
const minPairingFieldLength = 8;
const maxPairingFieldLength = 128;

function isLocalPhoneHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === [127, 0, 0, 1].join(".") || hostname === [0, 0, 0, 0].join(".");
}

function isSafePairingField(value: string): boolean {
  return value.length >= minPairingFieldLength && value.length <= maxPairingFieldLength && safePairingFieldPattern.test(value);
}

export function isValidRemoteOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ws:" || url.protocol === "wss:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function isCreateRemoteSessionResponse(value: unknown): value is CreateRemoteSessionResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    typeof candidate.playerToken === "string" &&
    candidate.playerToken.length > 0 &&
    typeof candidate.controllerToken === "string" &&
    candidate.controllerToken.length > 0 &&
    typeof candidate.remoteUrl === "string" &&
    candidate.remoteUrl.length > 0 &&
    typeof candidate.expiresAt === "string" &&
    Number.isFinite(Date.parse(candidate.expiresAt))
  );
}

export function validateControllerUrl(remoteUrl: string, production: boolean): ControllerUrlValidationResult {
  let url: URL;
  try {
    url = new URL(remoteUrl);
  } catch {
    return { ok: false, errorCode: "SESSION_RESPONSE_INVALID", error: "ChromeRemote relay returned an invalid session response." };
  }

  const sessionId = url.pathname.startsWith("/r/") ? url.pathname.slice("/r/".length) : "";
  if (!url.pathname.startsWith("/r/") || sessionId.length === 0 || url.hash.length <= 1 || url.search.length > 0) {
    return { ok: false, errorCode: "SESSION_RESPONSE_INVALID", error: "ChromeRemote relay returned an invalid session response." };
  }

  if (production && (url.protocol !== "https:" || isLocalPhoneHost(url.hostname))) {
    return { ok: false, errorCode: "REMOTE_SERVER_NOT_CONFIGURED", error: phoneAccessConfigurationError };
  }

  return { ok: true, url };
}

export function encodePairingPayload(sessionId: string, controllerToken: string): string {
  if (!isSafePairingField(sessionId) || !isSafePairingField(controllerToken)) {
    throw new Error("Invalid ChromeRemote pairing payload fields.");
  }

  return `${pairingPayloadPrefix}:${sessionId}:${controllerToken}`;
}

export function decodePairingPayload(rawPayload: string): PairingPayloadResult {
  const fields = rawPayload.trim().split(":");
  if (fields.length !== 3 || fields[0] !== pairingPayloadPrefix) {
    return { ok: false, error: "That isn't a ChromeRemote pairing code." };
  }

  const [, sessionId, controllerToken] = fields;
  if (!isSafePairingField(sessionId) || !isSafePairingField(controllerToken)) {
    return { ok: false, error: "That isn't a ChromeRemote pairing code." };
  }

  return { ok: true, payload: { sessionId, controllerToken } };
}

export function stopMediaStreamTracks(stream: { getTracks(): Array<{ stop(): void }> }): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function isPairingRequest(value: unknown): value is PairingRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === "REMOTE_PING" || candidate.type === "REMOTE_GET_STATUS" || candidate.type === "REMOTE_DISCONNECT") {
    return true;
  }

  if (candidate.type === "REMOTE_CONNECT_PHONE") {
    return typeof candidate.tabId === "number" && Number.isInteger(candidate.tabId) && typeof candidate.tabUrl === "string";
  }

  return false;
}

export function backgroundUnavailableResponse(): PairingResponse {
  return {
    ok: false,
    state: {
      status: "not-paired",
      errorCode: "BACKGROUND_UNAVAILABLE",
      error: "ChromeRemote background service is unavailable. Reload the extension."
    },
    errorCode: "BACKGROUND_UNAVAILABLE",
    error: "ChromeRemote background service is unavailable. Reload the extension."
  };
}
