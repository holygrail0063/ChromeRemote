export function seekYouTubeTo(seconds: number): void {
  if (!window.location.hostname.includes("youtube.com")) {
    throw new Error("YouTube seek is only available on YouTube.");
  }

  const video = document.querySelector<HTMLVideoElement>("video.html5-main-video");
  if (!video) {
    throw new Error("No YouTube video element detected.");
  }

  video.currentTime = seconds;
}
