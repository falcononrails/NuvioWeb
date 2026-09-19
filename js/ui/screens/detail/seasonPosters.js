// Metadata formats also accepted by NuvioDesktop's season picker.
export function getSeasonPosters(meta = {}, episodes = []) {
  const posters = new Map();
  const put = (season, value) => {
    if (season == null || !Number.isInteger(Number(season)) || Number(season) < 0 || typeof value !== "string") return false;
    let url = value.trim();
    if (/^\/[^/]/.test(url)) url = `https://image.tmdb.org/t/p/w342${url}`;
    try {
      const parsed = new URL(url);
      if (["http:", "https:"].includes(parsed.protocol)) {
        posters.set(Number(season), parsed.href);
        return true;
      }
    } catch (_) {}
  };
  Object.entries(meta?.seasonPosters || {}).forEach(([season, url]) => put(season, url));
  (Array.isArray(meta?.seasons) ? meta.seasons : []).forEach(season => put(season?.season_number ?? season?.number, season?.poster_path ?? season?.poster));
  const extras = meta?.app_extras?.seasonPosters;
  if (Array.isArray(extras)) {
    const seasons = [...new Set(episodes.map(episode => episode?.season).filter(Number.isInteger))].filter(season => season >= 0).sort((a,b) => a-b);
    const regular = seasons.filter(season => season > 0);
    const order = seasons.length === extras.length ? seasons
      : regular.length === extras.length ? regular
      : extras.length === regular.length + 1 && extras[0] == null ? [0, ...regular]
      : extras.map((_,index) => index + 1);
    extras.forEach((url,index) => put(order[index], url));
  }
  // Explicit per-episode season artwork takes priority over the season list.
  const seen = new Set();
  episodes.forEach(episode => {
    if (episode && !seen.has(episode.season) && put(episode.season, episode.seasonPoster || episode.season_poster_path)) {
      seen.add(episode.season);
    }
  });
  return posters;
}
