// A filename is only a hint. A missing browser capability is not proof that a
// file has no audio, and an advertised codec is not a guarantee for every profile.
export function browserSourceWarnings(stream = {}, video = globalThis.document?.createElement?.("video")) {
  const raw = stream.raw || stream;
  const label = [stream.label, raw.name, raw.title, raw.description, raw.behaviorHints?.filename].join(" ");
  const warnings = [];
  const canPlay = (mime) => {
    try { return Boolean(video?.canPlayType?.(mime)); } catch { return false; }
  };
  if (/\b(?:truehd|dts(?:-hd)?|eac-?3|e-ac-?3|ac-?3)\b|\bddp(?=\d|\b)/i.test(label)) {
    const codec = /\b(?:truehd|dts(?:-hd)?)\b/i.test(label) ? "" : /\b(?:eac-?3|e-ac-?3)\b|\bddp(?=\d|\b)/i.test(label) ? "ec-3" : "ac-3";
    if (!codec || !canPlay(`audio/mp4; codecs="${codec}"`)) {
      warnings.push("Audio may not play in this browser. Try an AAC source if it is silent.");
    }
  }
  const codec = /\b(?:hevc|[hx][ .]?265)\b/i.test(label) ? "hvc1.1.6.L93.B0"
    : /\bav1\b/i.test(label) ? "av01.0.05M.08" : "";
  if (codec && !canPlay(`video/mp4; codecs="${codec}"`)) {
    warnings.push("Video may not play in this browser. Try an H.264 source.");
  }
  return warnings;
}

export function canAmplifyBrowserMedia(video, origin = globalThis.location?.origin) {
  if (!video) return false;
  const source = video.currentSrc || video.src;
  if (!source) return false;
  // Native cross-origin media can play without CORS, but routing it through
  // Web Audio silences it. Never change crossOrigin just to enable a booster.
  try { return new URL(source, origin).origin === origin; } catch { return false; }
}

export function unavailableAudioMessage() {
  return "Audio track selection is unavailable for this source in this browser. Sound may still play. If it is silent, try an AAC source or an external player.";
}
