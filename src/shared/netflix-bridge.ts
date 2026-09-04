export const CHROMEREMOTE_BRIDGE_REQUEST_SOURCE = "CHROMEREMOTE_CONTENT";
export const CHROMEREMOTE_BRIDGE_RESPONSE_SOURCE = "CHROMEREMOTE_NETFLIX_ADAPTER";

export type NetflixBridgeCommand = "SEEK_TO" | "SEEK_RELATIVE" | "NEXT_EPISODE" | "FULLSCREEN" | "EXIT_FULLSCREEN";

export type NetflixBridgeRequest = {
  source: typeof CHROMEREMOTE_BRIDGE_REQUEST_SOURCE;
  requestId: string;
} & (
  | {
      type: "SEEK_TO" | "SEEK_RELATIVE";
      targetSeconds: number;
    }
  | {
      type: "NEXT_EPISODE" | "FULLSCREEN" | "EXIT_FULLSCREEN";
    }
);

export type NetflixBridgeResponse =
  | {
      source: typeof CHROMEREMOTE_BRIDGE_RESPONSE_SOURCE;
      requestId: string;
      ok: true;
    }
  | {
      source: typeof CHROMEREMOTE_BRIDGE_RESPONSE_SOURCE;
      requestId: string;
      ok: false;
      errorCode: string;
      error: string;
    };

export function isNetflixBridgeResponse(message: unknown): message is NetflixBridgeResponse {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as Record<string, unknown>;
  if (candidate.source !== CHROMEREMOTE_BRIDGE_RESPONSE_SOURCE || typeof candidate.requestId !== "string") {
    return false;
  }

  if (candidate.ok === true) {
    return true;
  }

  return candidate.ok === false && typeof candidate.errorCode === "string" && typeof candidate.error === "string";
}

export function isNetflixBridgeRequest(message: unknown): message is NetflixBridgeRequest {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as Record<string, unknown>;
  return (
    candidate.source === CHROMEREMOTE_BRIDGE_REQUEST_SOURCE &&
    typeof candidate.requestId === "string" &&
    (((candidate.type === "SEEK_TO" || candidate.type === "SEEK_RELATIVE") &&
      typeof candidate.targetSeconds === "number" &&
      Number.isFinite(candidate.targetSeconds) &&
      candidate.targetSeconds >= 0) ||
      candidate.type === "NEXT_EPISODE" ||
      candidate.type === "FULLSCREEN" ||
      candidate.type === "EXIT_FULLSCREEN")
  );
}
