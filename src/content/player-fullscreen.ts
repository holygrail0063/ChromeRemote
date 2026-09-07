const PLAYER_FULLSCREEN_CLASS = "chromeremote-player-fullscreen";
const PLAYER_FULLSCREEN_ROOT_CLASS = "chromeremote-player-fullscreen-active";
const PLAYER_FULLSCREEN_ANCESTOR_CLASS = "chromeremote-player-fullscreen-ancestor";
const PLAYER_FULLSCREEN_STYLE_ID = "chromeremote-player-fullscreen-style";
const PLAYER_FULLSCREEN_OVERLAY_ID = "chromeremote-player-fullscreen-overlay";

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
      position: static !important;
      z-index: auto !important;
      transform: none !important;
      filter: none !important;
      perspective: none !important;
      contain: none !important;
      clip: auto !important;
      clip-path: none !important;
      overflow: visible !important;
      opacity: 1 !important;
      isolation: auto !important;
      mix-blend-mode: normal !important;
      will-change: auto !important;
    }

    #${PLAYER_FULLSCREEN_OVERLAY_ID} {
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #000 !important;
      z-index: 2147483646 !important;
      pointer-events: none !important;
    }

    video.${PLAYER_FULLSCREEN_CLASS} {
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
      border: 0 !important;
      transform: none !important;
      object-fit: contain !important;
      object-position: center center !important;
      z-index: 2147483647 !important;
      background: #000 !important;
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function visibleVideoArea(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  const style = window.getComputedStyle(video);
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
    const area = visibleVideoArea(video);
    if (area > selectedArea) {
      selected = video;
      selectedArea = area;
    }
  }

  return selected ?? videos[0] ?? null;
}

function getYouTubeVideo(): HTMLVideoElement | null {
  return getLargestVisibleVideo("video.html5-main-video") ?? getLargestVisibleVideo("video");
}

function getNetflixVideo(): HTMLVideoElement | null {
  return getLargestVisibleVideo("video");
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

function ensureFullscreenOverlay(): void {
  if (document.getElementById(PLAYER_FULLSCREEN_OVERLAY_ID)) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = PLAYER_FULLSCREEN_OVERLAY_ID;
  overlay.setAttribute("aria-hidden", "true");
  (document.body ?? document.documentElement).appendChild(overlay);
}

function enterVideoViewportFullscreen(video: HTMLVideoElement): void {
  ensureFullscreenStyle();
  document.querySelectorAll(`.${PLAYER_FULLSCREEN_CLASS}`).forEach((active) => active.classList.remove(PLAYER_FULLSCREEN_CLASS));
  clearFullscreenAncestors();
  markFullscreenAncestors(video);
  ensureFullscreenOverlay();
  document.documentElement.classList.add(PLAYER_FULLSCREEN_ROOT_CLASS);
  document.body?.classList.add(PLAYER_FULLSCREEN_ROOT_CLASS);
  video.classList.add(PLAYER_FULLSCREEN_CLASS);
  window.dispatchEvent(new Event("resize"));
}

function exitViewportFullscreen(): boolean {
  const active = document.querySelector(`video.${PLAYER_FULLSCREEN_CLASS}`);
  active?.classList.remove(PLAYER_FULLSCREEN_CLASS);
  document.getElementById(PLAYER_FULLSCREEN_OVERLAY_ID)?.remove();
  clearFullscreenAncestors();
  document.documentElement.classList.remove(PLAYER_FULLSCREEN_ROOT_CLASS);
  document.body?.classList.remove(PLAYER_FULLSCREEN_ROOT_CLASS);
  window.dispatchEvent(new Event("resize"));
  return Boolean(active);
}

export async function enterYouTubePlayerFullscreen(): Promise<void> {
  const video = getYouTubeVideo();
  if (!video) {
    throw new Error("YouTube video is not available for fullscreen.");
  }

  enterVideoViewportFullscreen(video);
}

export async function enterNetflixPlayerFullscreen(_tryNetflixNativeFullscreen: () => Promise<void>): Promise<void> {
  const video = getNetflixVideo();
  if (!video) {
    throw new Error("Netflix video is not available for fullscreen.");
  }

  enterVideoViewportFullscreen(video);
}

export async function exitPlayerFullscreen(_tryNetflixNativeExit?: () => Promise<void>): Promise<void> {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // Continue with ChromeRemote's viewport cleanup below.
    }
  }

  exitViewportFullscreen();
}
