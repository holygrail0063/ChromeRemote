interface NetflixPlayerSession {
  playNextEpisode?: () => void;
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
  'button[data-uia="next-episode-button"]',
  'button[data-uia="next-episode"]',
  'button[data-uia="player-next-episode"]',
  'button[data-uia*="next-episode" i]',
  '[role="button"][data-uia*="next-episode" i]',
  'button[aria-label*="Next Episode" i]',
  'button[aria-label*="Next episode" i]',
  '[role="button"][aria-label*="Next Episode" i]',
  '[role="button"][aria-label*="Next episode" i]',
  'button[aria-label="Next" i]',
  '[role="button"][aria-label="Next" i]'
];

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function getVideoPlayer(): NetflixVideoPlayer | null {
  const pageWindow = window as NetflixPageWindow;
  return pageWindow.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer ?? null;
}

function orderedSessions(videoPlayer: NetflixVideoPlayer): Array<{ id: string; session: NetflixPlayerSession }> {
  const sessionIds = videoPlayer.getAllPlayerSessionIds?.();
  if (!Array.isArray(sessionIds) || sessionIds.length === 0 || !videoPlayer.getVideoPlayerBySessionId) {
    return [];
  }

  const resolved = sessionIds
    .map((id) => ({ id, session: videoPlayer.getVideoPlayerBySessionId?.(id) ?? null }))
    .filter((entry): entry is { id: string; session: NetflixPlayerSession } => entry.session !== null);

  return resolved.sort((left, right) => {
    const leftWatch = left.id.startsWith("watch-") ? 1 : 0;
    const rightWatch = right.id.startsWith("watch-") ? 1 : 0;
    if (leftWatch !== rightWatch) {
      return rightWatch - leftWatch;
    }

    const activeScore = (entry: { session: NetflixPlayerSession }): number => {
      try {
        return entry.session.isActive?.() === true || entry.session.isPlaying?.() === true ? 1 : 0;
      } catch {
        return 0;
      }
    };

    return activeScore(right) - activeScore(left);
  });
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
  control.focus({ preventScroll: true });
  control.click();
}

function sessionFingerprint(videoPlayer: NetflixVideoPlayer): string {
  const ids = videoPlayer.getAllPlayerSessionIds?.();
  return Array.isArray(ids) ? [...ids].sort().join("|") : "";
}

async function waitForTransition(
  videoPlayer: NetflixVideoPlayer,
  startUrl: string,
  startVideo: HTMLVideoElement | null,
  startSessionFingerprint: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (window.location.href !== startUrl) {
      return true;
    }

    const currentVideo = document.querySelector<HTMLVideoElement>("video");
    if (startVideo && currentVideo && currentVideo !== startVideo) {
      return true;
    }

    const currentFingerprint = sessionFingerprint(videoPlayer);
    if (startSessionFingerprint && currentFingerprint && currentFingerprint !== startSessionFingerprint) {
      return true;
    }

    await delay(100);
  }

  return false;
}

async function tryInternalNextEpisode(videoPlayer: NetflixVideoPlayer): Promise<boolean> {
  const startUrl = window.location.href;
  const startVideo = document.querySelector<HTMLVideoElement>("video");
  const startFingerprint = sessionFingerprint(videoPlayer);

  for (const { session } of orderedSessions(videoPlayer)) {
    if (typeof session.playNextEpisode !== "function") {
      continue;
    }

    try {
      session.playNextEpisode();
    } catch {
      continue;
    }

    if (await waitForTransition(videoPlayer, startUrl, startVideo, startFingerprint, 1800)) {
      return true;
    }
  }

  return false;
}

async function tryRenderedNextEpisode(videoPlayer: NetflixVideoPlayer): Promise<boolean> {
  const startUrl = window.location.href;
  const startVideo = document.querySelector<HTMLVideoElement>("video");
  const startFingerprint = sessionFingerprint(videoPlayer);
  const deadline = Date.now() + 1500;

  while (Date.now() < deadline) {
    const control = findNextEpisodeControl();
    if (control) {
      activate(control);
      if (await waitForTransition(videoPlayer, startUrl, startVideo, startFingerprint, 1800)) {
        return true;
      }

      // Netflix can reuse the same URL/session briefly after accepting the click. Treat a
      // successful rendered-control activation as accepted rather than seeking to the end.
      return true;
    }

    await delay(100);
  }

  return false;
}

export async function advanceNetflixEpisode(): Promise<void> {
  const videoPlayer = getVideoPlayer();
  if (!videoPlayer) {
    throw new Error("Netflix next episode is not available right now.");
  }

  // Never force an episode to its end to reveal the next button. That can leave Netflix on
  // a black post-play frame when the UI does not transition. Prefer Netflix's own player
  // session command, then the real rendered Next Episode control.
  if (await tryInternalNextEpisode(videoPlayer)) {
    return;
  }

  if (await tryRenderedNextEpisode(videoPlayer)) {
    return;
  }

  throw new Error("Netflix did not expose a usable next episode action.");
}
