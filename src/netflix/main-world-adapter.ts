const CHROMEREMOTE_BRIDGE_REQUEST_SOURCE = "CHROMEREMOTE_CONTENT";
const CHROMEREMOTE_BRIDGE_RESPONSE_SOURCE = "CHROMEREMOTE_NETFLIX_ADAPTER";
const SEEK_UNAVAILABLE_ERROR_CODE = "NETFLIX_SEEK_UNAVAILABLE";
const NEXT_EPISODE_UNAVAILABLE_ERROR_CODE = "NEXT_EPISODE_UNAVAILABLE";
const FULLSCREEN_UNAVAILABLE_ERROR_CODE = "FULLSCREEN_UNAVAILABLE";
const EXIT_FULLSCREEN_UNAVAILABLE_ERROR_CODE = "EXIT_FULLSCREEN_UNAVAILABLE";
const FULLSCREEN_REQUIRES_USER_GESTURE_ERROR_CODE = "FULLSCREEN_REQUIRES_USER_GESTURE";

type NetflixBridgeRequest = {
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

type NetflixBridgeResponse =
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

interface NetflixPlayerSession {
  seek?: (milliseconds: number) => void;
  isActive?: () => boolean;
  isPlaying?: () => boolean;
  getCurrentTime?: () => number;
}

interface NetflixVideoPlayer {
  getAllPlayerSessionIds?: () => string[];
  getVideoPlayerBySessionId?: (id: string) => NetflixPlayerSession | null | undefined;
}

interface NetflixPlayerApi {
  videoPlayer?: NetflixVideoPlayer;
}

interface NetflixPageWindow extends Window {
  netflix?: {
    appContext?: {
      state?: {
        playerApp?: {
          getAPI?: () => NetflixPlayerApi;
        };
      };
    };
  };
}

function isNetflixBridgeRequest(message: unknown): message is NetflixBridgeRequest {
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

function secondsToMilliseconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    throw new Error("Seek target must be a finite number of seconds.");
  }

  return Math.round(seconds * 1000);
}

function failure(requestId: string, errorCode: string, error: string): NetflixBridgeResponse {
  return {
    source: CHROMEREMOTE_BRIDGE_RESPONSE_SOURCE,
    requestId,
    ok: false,
    errorCode,
    error
  };
}

function success(requestId: string): NetflixBridgeResponse {
  return {
    source: CHROMEREMOTE_BRIDGE_RESPONSE_SOURCE,
    requestId,
    ok: true
  };
}

function postResponse(response: NetflixBridgeResponse): void {
  window.postMessage(response, window.location.origin);
}

function getVideoPlayer(): NetflixVideoPlayer | null {
  const pageWindow = window as NetflixPageWindow;
  const api = pageWindow.netflix?.appContext?.state?.playerApp?.getAPI?.();
  return api?.videoPlayer ?? null;
}

function resolveSession(videoPlayer: NetflixVideoPlayer): NetflixPlayerSession | null {
  const sessionIds = videoPlayer.getAllPlayerSessionIds?.();
  if (!Array.isArray(sessionIds) || sessionIds.length === 0 || !videoPlayer.getVideoPlayerBySessionId) {
    return null;
  }

  const sessions = sessionIds
    .map((sessionId) => videoPlayer.getVideoPlayerBySessionId?.(sessionId) ?? null)
    .filter((session): session is NetflixPlayerSession => session !== null && typeof session.seek === "function");

  if (sessions.length === 0) {
    return null;
  }

  const activeSession = sessions.find((session) => {
    try {
      return session.isActive?.() === true || session.isPlaying?.() === true;
    } catch {
      return false;
    }
  });

  if (activeSession) {
    return activeSession;
  }

  const currentTimeSeconds = document.querySelector("video")?.currentTime;
  if (Number.isFinite(currentTimeSeconds)) {
    const currentTimeMilliseconds = secondsToMilliseconds(currentTimeSeconds as number);
    const matchingSession = sessions.find((session) => {
      try {
        const sessionTime = session.getCurrentTime?.();
        return Number.isFinite(sessionTime) && Math.abs((sessionTime as number) - currentTimeMilliseconds) < 2000;
      } catch {
        return false;
      }
    });

    if (matchingSession) {
      return matchingSession;
    }
  }

  return sessions[0];
}

const nextEpisodeSelectors = [
  'button[data-uia="next-episode-seamless-button"]',
  'button[data-uia="next-episode-seamless-button-draining"]',
  'button[data-uia="next-episode-button"]',
  'button[data-uia="next-episode"]',
  'button[data-uia="player-next-episode"]',
  'button[data-uia*="next-episode" i]',
  '[role="button"][data-uia="next-episode-seamless-button"]',
  '[role="button"][data-uia="next-episode-button"]',
  '[role="button"][data-uia="next-episode"]',
  '[role="button"][data-uia*="next-episode" i]',
  'button[aria-label*="Next Episode" i]',
  'button[aria-label*="Next episode" i]',
  'button[aria-label="Next" i]',
  '[role="button"][aria-label*="Next Episode" i]',
  '[role="button"][aria-label*="Next episode" i]',
  '[role="button"][aria-label="Next" i]'
];

const fullscreenSelectors = [
  'button[data-uia="control-fullscreen-enter"]',
  'button[data-uia="control-fullscreen"]',
  'button[data-uia*="fullscreen" i]',
  '[role="button"][data-uia="control-fullscreen-enter"]',
  '[role="button"][data-uia="control-fullscreen"]',
  '[role="button"][data-uia*="fullscreen" i]',
  'button[aria-label*="Full screen" i]',
  'button[aria-label*="Fullscreen" i]',
  '[role="button"][aria-label*="Full screen" i]',
  '[role="button"][aria-label*="Fullscreen" i]'
];

const exitFullscreenSelectors = [
  'button[data-uia="control-fullscreen-exit"]',
  'button[data-uia="control-fullscreen"]',
  'button[data-uia*="fullscreen" i]',
  '[role="button"][data-uia="control-fullscreen-exit"]',
  '[role="button"][data-uia="control-fullscreen"]',
  '[role="button"][data-uia*="fullscreen" i]',
  'button[aria-label*="Exit full screen" i]',
  'button[aria-label*="Exit fullscreen" i]',
  '[role="button"][aria-label*="Exit full screen" i]',
  '[role="button"][aria-label*="Exit fullscreen" i]'
];

function wakeNetflixControls(): void {
  const target = document.querySelector("video") ?? document.querySelector('[data-uia="player"]') ?? document.body;
  const rect = target.getBoundingClientRect();
  const options = {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + Math.max(1, rect.width / 2),
    clientY: rect.top + Math.max(1, rect.height / 2)
  };

  target.dispatchEvent(new MouseEvent("mousemove", options));
  target.dispatchEvent(new PointerEvent("pointermove", options));
}

function isUsableControl(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element.getAttribute("aria-disabled") === "true") {
    return false;
  }

  if (element instanceof HTMLButtonElement && element.disabled) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function findUsableControl(selectors: string[]): HTMLElement | null {
  wakeNetflixControls();

  for (const selector of selectors) {
    const control = Array.from(document.querySelectorAll(selector)).find(isUsableControl);
    if (control) {
      return control;
    }
  }

  return null;
}

function activateControl(control: HTMLElement): void {
  control.focus();
  control.click();
}

function nextEpisode(requestId: string): NetflixBridgeResponse {
  const control = findUsableControl(nextEpisodeSelectors);
  if (!control) {
    return failure(requestId, NEXT_EPISODE_UNAVAILABLE_ERROR_CODE, "Next episode is not available right now.");
  }

  activateControl(control);
  return success(requestId);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function fullscreen(requestId: string): Promise<NetflixBridgeResponse> {
  const control = findUsableControl(fullscreenSelectors);
  if (!control) {
    return failure(requestId, FULLSCREEN_UNAVAILABLE_ERROR_CODE, "Netflix fullscreen control is not available right now.");
  }

  try {
    activateControl(control);
    await delay(300);
    if (document.fullscreenElement || window.innerHeight === screen.height) {
      return success(requestId);
    }

    return failure(
      requestId,
      FULLSCREEN_REQUIRES_USER_GESTURE_ERROR_CODE,
      "Chrome requires fullscreen to be started directly from the Netflix page."
    );
  } catch {
    return failure(
      requestId,
      FULLSCREEN_REQUIRES_USER_GESTURE_ERROR_CODE,
      "Chrome requires fullscreen to be started directly from the Netflix page."
    );
  }
}

async function exitFullscreen(requestId: string): Promise<NetflixBridgeResponse> {
  const control = findUsableControl(exitFullscreenSelectors);
  if (control) {
    activateControl(control);
    return success(requestId);
  }

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return success(requestId);
    }
  } catch {
    return failure(requestId, EXIT_FULLSCREEN_UNAVAILABLE_ERROR_CODE, "ChromeRemote could not exit fullscreen.");
  }

  return failure(requestId, EXIT_FULLSCREEN_UNAVAILABLE_ERROR_CODE, "Netflix exit fullscreen control is not available right now.");
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== window.location.origin || !isNetflixBridgeRequest(event.data)) {
    return;
  }

  const request = event.data;

  void (async () => {
    try {
      if (request.type === "NEXT_EPISODE") {
        postResponse(nextEpisode(request.requestId));
        return;
      }

      if (request.type === "FULLSCREEN") {
        postResponse(await fullscreen(request.requestId));
        return;
      }

      if (request.type === "EXIT_FULLSCREEN") {
        postResponse(await exitFullscreen(request.requestId));
        return;
      }

      if (request.type !== "SEEK_TO" && request.type !== "SEEK_RELATIVE") {
        return;
      }

      const videoPlayer = getVideoPlayer();
      if (!videoPlayer) {
        postResponse(failure(request.requestId, SEEK_UNAVAILABLE_ERROR_CODE, "ChromeRemote could not access Netflix's seek control."));
        return;
      }

      const session = resolveSession(videoPlayer);
      if (!session?.seek) {
        postResponse(
          failure(request.requestId, SEEK_UNAVAILABLE_ERROR_CODE, "ChromeRemote could not resolve an active Netflix player session.")
        );
        return;
      }

      session.seek(secondsToMilliseconds(request.targetSeconds));
      postResponse(success(request.requestId));
    } catch {
      const errorCode =
        request.type === "FULLSCREEN" ? FULLSCREEN_REQUIRES_USER_GESTURE_ERROR_CODE : SEEK_UNAVAILABLE_ERROR_CODE;
      const error =
        request.type === "FULLSCREEN"
          ? "Chrome requires fullscreen to be started directly from the Netflix page."
          : "ChromeRemote could not complete the Netflix seek command.";
      postResponse(failure(request.requestId, errorCode, error));
    }
  })();
});
