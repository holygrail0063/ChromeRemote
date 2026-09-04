export type NetflixPageContext = {
  isNetflix: boolean;
  isWatchPage: boolean;
};

export function getNetflixPageContext(rawUrl?: string): NetflixPageContext {
  if (!rawUrl) {
    return { isNetflix: false, isWatchPage: false };
  }

  try {
    const url = new URL(rawUrl);
    const isNetflix = url.hostname === "www.netflix.com";

    return {
      isNetflix,
      isWatchPage: isNetflix && url.pathname.startsWith("/watch/")
    };
  } catch {
    return { isNetflix: false, isWatchPage: false };
  }
}
