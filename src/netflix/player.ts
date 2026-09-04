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
      ended: video.ended
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
