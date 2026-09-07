const PLAYER_FULLSCREEN_CLASS = "chromeremote-player-fullscreen";
const PLAYER_FULLSCREEN_ROOT_CLASS = "chromeremote-player-fullscreen-active";
const PLAYER_FULLSCREEN_ANCESTOR_CLASS = "chromeremote-player-fullscreen-ancestor";
const PLAYER_FULLSCREEN_STYLE_ID = "chromeremote-player-fullscreen-style";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

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
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      transform: none !important;
      z-index: 2147483647 !important;
      background: #000 !important;
      overflow: hidden !important;
      isolation: isolate !important;
    }

    video.${PLAYER_FULLSCREEN_CLASS} {
      object-fit: contain !important;
    }

    .${PLAYER_FULLSCREEN_CLASS} video,
    .${PLAYER_FULLSCREEN_CLASS} .html5-main-video {
      position: absolute !important;
      inset: 0 !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      transform: none !important;
      object-fit: contain !important;
    }
  `;
  document.documentElement.appendChild(style);
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

function enterViewportFullscreen(element: HTMLElement): void {
  ensureFullscreenStyle();
  document.querySelectorAll(`.${PLAYER_FULLSCREEN_CLASS}`).forEach((active) => active.classList.remove(PLAYER_FULLSCREEN_CLASS));
  clearFullscreenAncestors();
  markFullscreenAncestors(element);
  document.documentElement.classList.add(PLAYER_FULLSCREEN_ROOT_CLASS);
  document.body?.classList.add(PLAYER_FULLSCREEN_ROOT_CLASS);
  element.classList.add(PLAYER_FULLSCREEN_CLASS);
}

function exitViewportFullscreen(): boolean {
  const active = document.querySelector(`.${PLAYER_FULLSCREEN_CLASS}`);
  active?.classList.remove(PLAYER_FULLSCREEN_CLASS);
  clearFullscreenAncestors();
  document.documentElement.classList.remove(PLAYER_FULLSCREEN_ROOT_CLASS);
  document.body?.classList.remove(PLAYER_FULLSCREEN_ROOT_CLASS);
  return Boolean(active);
}

function getYouTubePlayerRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#movie_player, .html5-video-player");
}

function getNetflixPlayerRoot(): HTMLElement | null {
  return document.querySelector<HTMLVideoElement>("video");
}

async function tryNativeFullscreen(element: HTMLElement, control?: HTMLElement | null): Promise<boolean> {
  if (document.fullscreenElement) {
    return true;
  }

  if (control) {
    try {
      control.click();
      await delay(250);
      if (document.fullscreenElement) {
        return true;
      }
    } catch {
      // Fall through to the Fullscreen API, then the viewport fallback.
    }
  }

  try {
    await element.requestFullscreen();
    return Boolean(document.fullscreenElement);
  } catch {
    return false;
  }
}

export async function enterYouTubePlayerFullscreen(): Promise<void> {
  const player = getYouTubePlayerRoot();
  if (!player) {
    throw new Error("YouTube player is not available for fullscreen.");
  }

  const control = player.querySelector<HTMLElement>(".ytp-fullscreen-button");
  if (await tryNativeFullscreen(player, control)) {
    return;
  }

  enterViewportFullscreen(player);
}

export async function enterNetflixPlayerFullscreen(tryNetflixNativeFullscreen: () => Promise<void>): Promise<void> {
  const player = getNetflixPlayerRoot();
  if (!player) {
    throw new Error("Netflix player is not available for fullscreen.");
  }

  try {
    await tryNetflixNativeFullscreen();
    if (document.fullscreenElement) {
      return;
    }
  } catch {
    // Chrome can reject remote native fullscreen because there is no local user gesture.
  }

  enterViewportFullscreen(player);
}

export async function exitPlayerFullscreen(tryNetflixNativeExit?: () => Promise<void>): Promise<void> {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
      exitViewportFullscreen();
      return;
    } catch {
      // Fall through to the viewport/native fallback cleanup.
    }
  }

  if (exitViewportFullscreen()) {
    return;
  }

  if (tryNetflixNativeExit) {
    try {
      await tryNetflixNativeExit();
    } catch {
      // Exit is idempotent from the phone; no fullscreen state is also success.
    }
  }
}
