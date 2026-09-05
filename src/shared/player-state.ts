export type PlayerState = {
  detected: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  muted: boolean;
  readyState: number;
  ended: boolean;
  title?: string;
  episode?: string;
};

export const unavailablePlayerState: PlayerState = {
  detected: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 0,
  playbackRate: 1,
  muted: false,
  readyState: 0,
  ended: false
};
