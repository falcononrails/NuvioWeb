// Shared by local playback and the bridge; Matroska commonly uses ISO 639-2 codes.
export function selectAudioTrack(tracks, preferredLanguages = []) {
  const language = (value) => {
    try { return new Intl.Locale(value).language; } catch { return "und"; }
  };
  for (const preferred of preferredLanguages) {
    const code = language(preferred);
    const match = code !== "und" && tracks.find(track => language(track.language) === code);
    if (match) return match.index;
  }
  return (tracks.find(track => track.default) || tracks[0])?.index;
}
