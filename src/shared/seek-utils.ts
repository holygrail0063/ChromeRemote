export const SEEK_UNAVAILABLE_ERROR_CODE = "NETFLIX_SEEK_UNAVAILABLE";

export function assertFiniteSeconds(seconds: number): void {
  if (!Number.isFinite(seconds)) {
    throw new Error("Seek target must be a finite number of seconds.");
  }
}

export function secondsToMilliseconds(seconds: number): number {
  assertFiniteSeconds(seconds);
  return Math.round(seconds * 1000);
}

export function clampSeekSeconds(targetSeconds: number, durationSeconds: number): number {
  assertFiniteSeconds(targetSeconds);

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return Math.max(0, targetSeconds);
  }

  return Math.min(Math.max(0, targetSeconds), durationSeconds);
}
