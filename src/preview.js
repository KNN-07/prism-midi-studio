const PROFILES = Object.freeze({
  balanced: Object.freeze({ fps: 60, maxPixels: 1920 * 1080 }),
  economy: Object.freeze({ fps: 30, maxPixels: 1280 * 720 }),
  native: Object.freeze({ fps: 60, maxPixels: Infinity }),
});

export function previewProfile(quality) { return PROFILES[quality] || PROFILES.balanced; }

/** Bound preview fill rate independently of screenshot and recording resolution. */
export function previewSize(cssWidth, cssHeight, pixelRatio = 1, quality = 'balanced') {
  const ratio = Math.max(1, Math.min(2, Number.isFinite(pixelRatio) ? pixelRatio : 1));
  const width = Math.max(1, cssWidth * ratio), height = Math.max(1, cssHeight * ratio);
  const scale = Math.min(1, Math.sqrt(previewProfile(quality).maxPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
