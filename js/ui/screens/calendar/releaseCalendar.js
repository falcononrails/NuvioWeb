// Library-release calendar inspired by lucaboox/nuvio-web; uses our addon metadata.
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function releaseDateKey(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const plain = new Date(year, month - 1, day, 12);
  if (plain.getFullYear() !== year || plain.getMonth() !== month - 1 || plain.getDate() !== day) return null;
  if (value.trim().length === 10) return localDateKey(plain);
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? localDateKey(instant) : null;
}

export function monthDays(year, month) {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= count ? localDateKey(new Date(year, month, day, 12)) : null;
  });
}

function releaseValue(item) {
  return item.released || item.releaseDate || item.release_date || item.firstAired || item.first_aired || item.airDate || item.air_date;
}

export function buildReleaseEvents(metas = []) {
  const events = new Map();
  for (const meta of metas) {
    if (!meta?.id) continue;
    const isMovie = String(meta.type).toLowerCase() === "movie";
    const entries = isMovie ? [meta] : Array.isArray(meta.videos) ? meta.videos : [];
    for (const video of entries) {
      if (!video || typeof video !== "object") continue;
      const date = releaseDateKey(releaseValue(video));
      if (!date) continue;
      const key = `${meta.type}:${meta.id}:${isMovie ? "movie" : `${video.season ?? ""}:${video.episode ?? video.id ?? ""}`}`;
      events.set(key, { key, date, meta, video: isMovie ? null : video });
    }
  }
  return [...events.values()].sort((a,b) => a.date.localeCompare(b.date)
    || String(a.meta.name).localeCompare(String(b.meta.name))
    || Number(a.video?.season || 0) - Number(b.video?.season || 0)
    || Number(a.video?.episode || 0) - Number(b.video?.episode || 0));
}
