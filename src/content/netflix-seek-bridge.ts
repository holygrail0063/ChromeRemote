import {
  CHROMEREMOTE_BRIDGE_REQUEST_SOURCE,
  isNetflixBridgeResponse,
  type NetflixBridgeCommand,
  type NetflixBridgeRequest
} from "../shared/netflix-bridge";

const ADAPTER_TIMEOUT_MS = 1500;

export async function requestNetflixAdapter(type: "SEEK_TO" | "SEEK_RELATIVE", targetSeconds: number): Promise<void>;
export async function requestNetflixAdapter(type: "NEXT_EPISODE" | "FULLSCREEN" | "EXIT_FULLSCREEN"): Promise<void>;
export async function requestNetflixAdapter(type: NetflixBridgeCommand, targetSeconds?: number): Promise<void> {
  const requestId = crypto.randomUUID();
  const request: NetflixBridgeRequest =
    type === "SEEK_TO" || type === "SEEK_RELATIVE"
      ? {
          source: CHROMEREMOTE_BRIDGE_REQUEST_SOURCE,
          requestId,
          type,
          targetSeconds: targetSeconds ?? Number.NaN
        }
      : {
          source: CHROMEREMOTE_BRIDGE_REQUEST_SOURCE,
          requestId,
          type
        };

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener("message", handleResponse);
      reject(new Error("ChromeRemote could not reach Netflix's player controls."));
    }, ADAPTER_TIMEOUT_MS);

    function handleResponse(event: MessageEvent<unknown>) {
      if (event.source !== window || event.origin !== window.location.origin || !isNetflixBridgeResponse(event.data)) {
        return;
      }

      if (event.data.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeoutId);
      window.removeEventListener("message", handleResponse);

      if (event.data.ok) {
        resolve();
        return;
      }

      const error = new Error(event.data.error);
      error.name = event.data.errorCode;
      reject(error);
    }

    window.addEventListener("message", handleResponse);
    window.postMessage(request, window.location.origin);
  });
}
