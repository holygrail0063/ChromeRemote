export type SupportedPlayerSite = "netflix" | "youtube";

export type NetflixPageContext = {
  isNetflix: boolean;
  isYouTube: boolean;
  isSupportedSite: boolean;
  isWatchPage: boolean;
  site: SupportedPlayerSite | null;
};

function emptyContext(): NetflixPageContext {
  return {
    isNetflix: false,
    isYouTube: false,
    isSupportedSite: false,
    isWatchPage: false,
    site: null
  };
}

export function getNetflixPageContext(rawUrl?: string): NetflixPageContext {
  if (!rawUrl) {
    return emptyContext();
  }

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const isNetflix = hostname === "www.netflix.com" || hostname === "netflix.com";
    const isYouTube = hostname === "www.youtube.com" || hostname === "youtube.com" || hostname === "m.youtube.com";
    const netflixWatchPage = isNetflix && url.pathname.startsWith("/watch/");
    const youtubeWatchPage = isYouTube && url.pathname === "/watch" && Boolean(url.searchParams.get("v"));
    const site: SupportedPlayerSite | null = isNetflix ? "netflix" : isYouTube ? "youtube" : null;

    return {
      isNetflix,
      isYouTube,
      isSupportedSite: Boolean(site),
      isWatchPage: netflixWatchPage || youtubeWatchPage,
      site
    };
  } catch {
    return emptyContext();
  }
}
