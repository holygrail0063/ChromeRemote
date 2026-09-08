const PLAYER_FULLSCREEN_CLASS = "chromeremote-player-fullscreen";
const PLAYER_FULLSCREEN_ROOT_CLASS = "chromeremote-player-fullscreen-active";
const PLAYER_FULLSCREEN_ANCESTOR_CLASS = "chromeremote-player-fullscreen-ancestor";
const PLAYER_FULLSCREEN_STYLE_ID = "chromeremote-player-fullscreen-style";

function ensureFullscreenStyle(): void {
  if (document.getElementById(PLAYER_FULLSCREEN_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = PLAYER_FULLSCREEN_STYLE_ID;
  style.textContent = `
    html.${PLAYER_FULLSCREEN_ROOT_CLASS},
    html.${PLAYER_FULLSCREEN_ROOT_CLASS} body {
      overflow: hidden !important;
      background: #000 !important;
    }

    .${PLAYER_FULLSCREEN_ANCESTOR_CLASS} {
      transform: none !important;
      filter: none !important;
      perspective: none !important;
      contain: none !important;
      clip: auto !important;
      clip-path: none !important;
      overflow: visible !important;
    }

    .${PLAYER_FULLSCREEN_CLASS} {
      position: fixed !important;
      inset: 0 !important;
      top: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      min-width: 100vw !important;
      min-height: 100vh !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      transform: none !important;
      z-index: 2147483647 !important;
      background: #000 !important;
      overflow: hidden !important;
      isolation: isolate !important;
      visibility: visible !important;
      opacity: 1 !important;
    }

    #movie_player.${PLAYER_FULLSCREEN_CLASS},
    .html5-video-player.${PLAYER_FULLSCREEN_CLASS} {
      width: 100vw !important;
      height: 100vh !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function visibleArea(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
    return 0;
  }

  return rect.width * rect.height;
}

function getLargestVisibleVideo(selector: string): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>(selector));
  let selected: HTMLVideoElement | null = null;
  let selectedArea = 0;

  for (const video of videos) {
    const area = visibleArea(video);
    if (area > selectedArea) {
      selected = video;
      selectedArea = area;
    }
  }

  return selected ?? videos[0] ?? null;
}

function findContainingRoot(video: HTMLVideoElement, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const containing = candidates
      .filter((candidate) => candidate !== video && candidate.contains(video))
      .sort((left, right) => visibleArea(right) - visibleArea(left));

    if (containing[0]) {
      return containing[0];
    }
  }

  return null;
}

function findLargeVideoAncestor(video: HTMLVideoElement): HTMLElement | null {
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  let ancestor = video.parentElement;
  let best: HTMLElement | null = null;

  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const area = visibleArea(ancestor);
    if (area > 0) {
      best = ancestor;
      if (area >= viewportArea * 0.7) {
        return ancestor;
      }
    }
    ancestor = ancestor.parentElement;
  }

  return best;
}

function getYouTubePlayerRoot(): HTMLElement | null {
  const video = getLargestVisibleVideo("video.html5-main-video") ?? getLargestVisibleVideo("video");
  if (!video) {
    return null;
  }

  return (
    video.closest<HTMLElement>("#movie_player, .html5-video-player") ??
    document.querySelector<HTMLElement>("#movie_player, .html5-video-player") ??
    findLargeVideoAncestor(video)
  );
}

function getNetflixPlayerRoot(): HTMLElement | null {
  const video = getLargestVisibleVideo("video");
  if (!video) {
    return null;
  }

  return (
    findContainingRoot(video, [
      '[data-uia="player"]',
      ".watch-video--player-view",
      ".watch-video",
      '[data-uia="video-canvas"]'
    ]) ?? findLargeVideoAncestor(video)
  );
}

function markFullscreenAncestors(element: HTMLElement): void {
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    ancestor.classList.add(PLAYER_FULLSCREEN_ANCESTOR_CLASS);
    ancestor = ancestor.parentElement;
  }
}

function clearFullscreenAncestors(): void {
  document.querySelectorAll(`.${PLAYER_FULLSCREEN_ANCESTOR_CLASS}`).forEach((ancestor) => {
    ancestor.classList.remove(PLAYER_FULLSCREEN_ANCESTOR_CLASS);
  });
}

function enterViewportFullscreen(root: HTMLElement): void {
  ensureFullscreenStyle();
  document.querySelectorAll(`.${PLAYER_FULLSCREEN_CLASS}`).forEach((active) => active.classList.remove(PLAYER_FULLSCREEN_CLASS));
  clearFullscreenAncestors();
  markFullscreenAncestors(root);
  document.documentElement.classList.add(PLAYER_FULLSCREEN_ROOT_CLASS);
  document.body?.classList.add(PLAYER_FULLSCREEN_ROOT_CLASS);
  root.classList.add(PLAYER_FULLSCREEN_CLASS);

  // Give site-owned player layout code a chance to recalculate inside the new viewport-sized shell.
  window.dispatchEvent(new Event("resize"));
  window.setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
}

function exitViewportFullscreen(): boolean {
  const active = document.querySelector<HTMLElement>(`.${PLAYER_FULLSCREEN_CLASS}`);
  active?.classList.remove(PLAYER_FULLSCREEN_CLASS);
  clearFullscreenAncestors();
  document.documentElement.classList.remove(PLAYER_FULLSCREEN_ROOT_CLASS);
  document.body?.classList.remove(PLAYER_FULLSCREEN_ROOT_CLASS);
  window.dispatchEvent(new Event("resize"));
  return Boolean(active);
}

export async function enterYouTubePlayerFullscreen(): Promise<void> {
  const root = getYouTubePlayerRoot();
  if (!root) {
    throw new Error("YouTube player is not available for fullscreen.");
  }

  enterViewportFullscreen(root);
}

export async function enterNetflixPlayerFullscreen(_tryNetflixNativeFullscreen: () => Promise<void>): Promise<void> {
  const root = getNetflixPlayerRoot();
  if (!root) {
    throw new Error("Netflix player is not available for fullscreen.");
  }

  enterViewportFullscreen(root);
}

export async function exitPlayerFullscreen(_tryNetflixNativeExit?: () => Promise<void>): Promise<void> {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // Continue with ChromeRemote's player-shell cleanup below.
    }
  }

  exitViewportFullscreen();
}
