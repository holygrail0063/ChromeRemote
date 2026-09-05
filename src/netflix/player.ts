import { unavailablePlayerState, type PlayerState } from "../shared/player-state";

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

function getMediaDetails(): { title?: string; episode?: string } {
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

export class NetflixPlayer {
  getVideo(): HTMLVideoElement | null {
    const videos = Array.from(document.querySelectorAll("video"));
    return videos.find((video) => video.readyState > 0 || Number.isFinite(video.duration)) ?? videos[0] ?? null;
  }

  getState(): PlayerState {
    const video = this.getVideo();
    if (!video) {
      return unavailablePlayerState;
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
      ...getMediaDetails()
    };
  }

  async play(): Promise<void> {
    const video = this.requireVideo();
    await video.play();
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

  private requireVideo(): HTMLVideoElement {
    const video = this.getVideo();
    if (!video) {
      throw new Error("No Netflix video element detected.");
    }

    return video;
  }
}
