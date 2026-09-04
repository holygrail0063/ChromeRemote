export const REMOTE_HTTP_ORIGIN =
  import.meta.env.VITE_REMOTE_HTTP_ORIGIN;

export const REMOTE_WS_ORIGIN =
  import.meta.env.VITE_REMOTE_WS_ORIGIN ??
  (new URL(REMOTE_HTTP_ORIGIN).protocol === "https:"
    ? REMOTE_HTTP_ORIGIN.replace(/^https:/, "wss:")
    : REMOTE_HTTP_ORIGIN.replace(/^http:/, "ws:"));

export const REMOTE_WEB_ORIGIN =
  import.meta.env.VITE_REMOTE_WEB_ORIGIN ?? REMOTE_HTTP_ORIGIN;
