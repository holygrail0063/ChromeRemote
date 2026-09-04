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
