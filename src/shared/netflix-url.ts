export type SupportedPlayerSite = "netflix" | "youtube";

export type NetflixPageContext = {
  isNetflix: boolean;
  isYouTube: boolean;
  isSupportedSite: boolean;
  isWatchPage: boolean;
  isPlaybackPage: boolean;
  site: SupportedPlayerSite | null;
};

function emptyContext(): NetflixPageContext {
  return {
    isNetflix: false,
    isYouTube: false,
    isSupportedSite: false,
    isWatchPage: false,
    isPlaybackPage: false,
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
    const isPlaybackPage = netflixWatchPage || youtubeWatchPage;

    return {
      isNetflix,
      isYouTube,
      isSupportedSite: Boolean(site),
      // The background worker historically uses isWatchPage to decide whether a
      // paired tab remains controllable. YouTube must stay valid while navigating
      // to /results so the phone can search repeatedly without losing its session.
      isWatchPage: isNetflix ? netflixWatchPage : isYouTube,
      isPlaybackPage,
      site
    };
  } catch {
    return emptyContext();
  }
}
