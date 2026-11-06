/** Blurred note layers are expensive to rasterize but do not change while an
 * unclipped note falls. Keep only their soft shadows in a bounded atlas cache;
 * the renderer still draws sharp note edges/materials at their exact position. */
export class NoteShadowCache {
  constructor(createLayer, maxPixels = 2 * 1024 * 1024) {
    this.createLayer = createLayer;
    this.maxPixels = maxPixels;
    this.pixels = 0;
    this.entries = new Map();
  }

  clear() {
    for (const entry of this.entries.values()) {
      entry.canvas.width = 1; entry.canvas.height = 1;
    }
    this.entries.clear(); this.pixels = 0;
  }

  get(key, { x, width, height, radius, blur, shadow, stops, strokes }) {
    let entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key); this.entries.set(key, entry);
      return entry;
    }
    const padding = Math.ceil(blur * 2 + Math.max(...strokes.map(stroke => stroke.width)) / 2 + 2);
    const tileWidth = Math.ceil(width + padding * 2 + 1);
    const tileHeight = Math.ceil(height + padding * 2 + 1);
    const pixels = tileWidth * tileHeight * 3;
    if (pixels > this.maxPixels) return null;
    while (this.pixels + pixels > this.maxPixels || this.entries.size >= 128) {
      const oldestKey = this.entries.keys().next().value;
      const oldest = this.entries.get(oldestKey);
      this.pixels -= oldest.pixels;
      oldest.canvas.width = 1; oldest.canvas.height = 1;
      this.entries.delete(oldestKey);
    }
    const layer = this.createLayer(tileWidth * 3, tileHeight);
    if (!layer) return null;
    const c = layer.ctx;
    const shift = tileWidth * 4;
    // Move the source shape entirely outside the atlas, bringing only its
    // shadow back with shadowOffsetX. Each tile retains one original pass so
    // shadows can be interleaved with fills/strokes in the original order.
    for (let pass = 0; pass < 3; pass++) {
      const sourceX = pass * tileWidth + padding + (x - Math.floor(x)) - shift;
      c.save();
      c.beginPath(); c.rect(pass * tileWidth, 0, tileWidth, tileHeight); c.clip();
      c.shadowColor = shadow; c.shadowBlur = blur;
      c.shadowOffsetX = shift; c.shadowOffsetY = 0;
      c.beginPath(); c.roundRect(sourceX, padding, width, height, Math.min(radius, width / 2, height / 2));
      if (pass === 0) {
        const fill = c.createLinearGradient(sourceX, 0, sourceX + width, 0);
        for (const [offset, color] of stops) fill.addColorStop(offset, color);
        c.fillStyle = fill; c.fill();
      } else {
        c.strokeStyle = strokes[pass - 1].color;
        c.lineWidth = strokes[pass - 1].width; c.stroke();
      }
      c.restore();
    }
    entry = { canvas: layer.canvas, tileWidth, tileHeight, padding, pixels };
    this.entries.set(key, entry); this.pixels += pixels;
    return entry;
  }

  draw(context, entry, pass, x, y) {
    context.drawImage(entry.canvas, pass * entry.tileWidth, 0, entry.tileWidth, entry.tileHeight,
      Math.floor(x) - entry.padding, y - entry.padding, entry.tileWidth, entry.tileHeight);
  }
}
