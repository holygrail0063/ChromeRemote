import { unavailablePlayerState, type PlayerPlatform, type PlayerState } from "../shared/player-state";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const safeDuration = (video: HTMLVideoElement) => {
  if (!Number.isFinite(video.duration) || Number.isNaN(video.duration) || video.duration < 0) {
    return 0;
  }

  return video.duration;
};

const safePlaybackRate = (video: HTMLVideoElement) => {
  if (!Number.isFinite(video.playbackRate) || video.playbackRate <= 0) {
    return 1;
  }

  return video.playbackRate;
};

function cleanText(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : undefined;
}

function firstText(selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const text = cleanText(document.querySelector(selector)?.textContent);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function getPlatform(): PlayerPlatform {
  return window.location.hostname.includes("youtube.com") ? "youtube" : "netflix";
}

function getNetflixMediaDetails(): { title?: string; episode?: string } {
  const titleFromPlayer = firstText([
    '[data-uia="video-title"] [data-uia="title"]',
    '[data-uia="video-title"] .ellipsize-text',
    '[data-uia="player-title"]',
    '.video-title .ellipsize-text',
    '.video-title h4'
  ]);

  const episode = firstText([
    '[data-uia="episode-title"]',
    '[data-uia*="episode-title" i]',
    '[data-uia="video-title"] [data-uia*="episode" i]',
    '.video-title .episode-title'
  ]);

  const pageTitle = cleanText(
    document.title
      .replace(/^Watch\s+/i, "")
      .replace(/\s*(?:\||-)\s*Netflix\s*$/i, "")
      .replace(/^Netflix$/i, "")
  );

  const title = titleFromPlayer ?? pageTitle;
  return {
    ...(title ? { title } : {}),
    ...(episode && episode !== title ? { episode } : {})
  };
}

function getYouTubeMediaDetails(): { title?: string; episode?: string } {
  const title =
    firstText(["h1.ytd-watch-metadata yt-formatted-string", "#title h1 yt-formatted-string", "h1.title yt-formatted-string"]) ??
    cleanText(document.title.replace(/\s*-\s*YouTube\s*$/i, ""));
  const channel = firstText(["#owner #channel-name a", "ytd-channel-name a", "#upload-info #channel-name"]);

  return {
    ...(title ? { title } : {}),
    ...(channel ? { episode: channel } : {})
  };
}

function getMediaDetails(platform: PlayerPlatform): { title?: string; episode?: string } {
  return platform === "youtube" ? getYouTubeMediaDetails() : getNetflixMediaDetails();
}

export class NetflixPlayer {
  getVideo(): HTMLVideoElement | null {
    if (getPlatform() === "youtube") {
      return document.querySelector<HTMLVideoElement>("video.html5-main-video");
    }

    const videos = Array.from(document.querySelectorAll("video"));
    return videos.find((video) => video.readyState > 0 || Number.isFinite(video.duration)) ?? videos[0] ?? null;
  }

  getState(): PlayerState {
    const platform = getPlatform();
    const video = this.getVideo();
    if (!video) {
      return { ...unavailablePlayerState, platform };
    }

    return {
      detected: true,
      playing: !video.paused && !video.ended,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: safeDuration(video),
      volume: clamp(video.volume, 0, 1),
      playbackRate: safePlaybackRate(video),
      muted: video.muted,
      readyState: video.readyState,
      ended: video.ended,
      platform,
      ...getMediaDetails(platform)
    };
  }

  async play(): Promise<void> {
    await this.requireVideo().play();
  }

  pause(): void {
    this.requireVideo().pause();
  }

  setVolume(volume: number): void {
    this.requireVideo().volume = clamp(volume, 0, 1);
  }

  setPlaybackRate(rate: number): void {
    this.requireVideo().playbackRate = rate;
  }

  toggleMute(): void {
    const video = this.requireVideo();
    video.muted = !video.muted;
  }

  nextYouTubeVideo(): void {
    const nextButton = document.querySelector<HTMLAnchorElement | HTMLButtonElement>(".ytp-next-button");
    if (!nextButton) {
      throw new Error("YouTube next video control is not available.");
    }
    nextButton.click();
  }

  private requireVideo(): HTMLVideoElement {
    const video = this.getVideo();
    if (!video) {
      throw new Error(`No ${getPlatform() === "youtube" ? "YouTube" : "Netflix"} video element detected.`);
    }

    return video;
  }
}
