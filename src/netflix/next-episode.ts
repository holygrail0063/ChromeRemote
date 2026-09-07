interface NetflixPlayerSession {
  seek?: (milliseconds: number) => void;
  play?: () => void;
  getDuration?: () => number;
  isActive?: () => boolean;
  isPlaying?: () => boolean;
}

interface NetflixVideoPlayer {
  getAllPlayerSessionIds?: () => string[];
  getVideoPlayerBySessionId?: (id: string) => NetflixPlayerSession | null | undefined;
}

interface NetflixPageWindow extends Window {
  netflix?: {
    appContext?: {
      state?: {
        playerApp?: {
          getAPI?: () => { videoPlayer?: NetflixVideoPlayer };
        };
      };
    };
  };
}

const nextEpisodeSelectors = [
  '[data-uia="next-episode-seamless-button-draining"]',
  '[data-uia="next-episode-seamless-button"]',
  '.watch-video--skip-content-button',
  '.watch-video--skip-preplay-button',
  'button[data-uia*="next-episode" i]',
  '[role="button"][data-uia*="next-episode" i]',
  'button[aria-label*="Next Episode" i]',
  '[role="button"][aria-label*="Next Episode" i]'
];

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function getVideoPlayer(): NetflixVideoPlayer | null {
  const pageWindow = window as NetflixPageWindow;
  return pageWindow.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer ?? null;
}

function getWatchSession(videoPlayer: NetflixVideoPlayer): NetflixPlayerSession | null {
  const sessionIds = videoPlayer.getAllPlayerSessionIds?.();
  if (!Array.isArray(sessionIds) || sessionIds.length === 0 || !videoPlayer.getVideoPlayerBySessionId) {
    return null;
  }

  const watchId = sessionIds.find((id) => id.startsWith("watch-"));
  if (watchId) {
    const watchSession = videoPlayer.getVideoPlayerBySessionId(watchId);
    if (watchSession) {
      return watchSession;
    }
  }

  const sessions = sessionIds
    .map((id) => videoPlayer.getVideoPlayerBySessionId?.(id) ?? null)
    .filter((session): session is NetflixPlayerSession => session !== null);

  const active = sessions.find((session) => {
    try {
      return session.isActive?.() === true || session.isPlaying?.() === true;
    } catch {
      return false;
    }
  });

  return active ?? sessions[0] ?? null;
}

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

function isVisible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element instanceof HTMLButtonElement && element.disabled) {
    return false;
  }

  if (element.getAttribute("aria-disabled") === "true") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

function findNextEpisodeControl(): HTMLElement | null {
  wakeNetflixControls();

  for (const selector of nextEpisodeSelectors) {
    const candidate = Array.from(document.querySelectorAll(selector)).find(isVisible);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function activate(control: HTMLElement): void {
  control.focus();
  control.click();
}

async function waitForNextEpisode(startUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (window.location.href !== startUrl) {
      return true;
    }

    const control = findNextEpisodeControl();
    if (control) {
      activate(control);
      return true;
    }

    await delay(100);
  }

  return window.location.href !== startUrl;
}

export async function advanceNetflixEpisode(): Promise<void> {
  const immediateControl = findNextEpisodeControl();
  if (immediateControl) {
    activate(immediateControl);
    return;
  }

  const videoPlayer = getVideoPlayer();
  const session = videoPlayer ? getWatchSession(videoPlayer) : null;
  const durationMs = session?.getDuration?.();

  if (!session?.seek || !Number.isFinite(durationMs) || (durationMs as number) <= 1000) {
    throw new Error("Netflix next episode is not available right now.");
  }

  const startUrl = window.location.href;

  // Netflix's own player-session seek is required here. Writing video.currentTime directly
  // can trigger Netflix M7375, so advance to the end through the same safe internal API.
  session.seek(Math.max(0, (durationMs as number) - 500));
  try {
    session.play?.();
  } catch {
    // The end-card can still render while paused, so continue polling.
  }

  if (await waitForNextEpisode(startUrl, 5000)) {
    return;
  }

  throw new Error("Netflix did not expose the next episode control after advancing to the end.");
}
