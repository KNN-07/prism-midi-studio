const BLACK = new Set([1, 3, 6, 8, 10]);
const PITCHES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const hash = (value) => { const n = Math.sin(value * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
const rgb = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
const rgba = (color, alpha) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
const mix = (a, b, amount) => a.map((channel, i) => Math.round(channel + (b[i] - channel) * amount));

function rainbow(hue) {
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (0.7 - 0.27 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

function rounded(context, x, y, width, height, radius) {
  if (width <= 0 || height <= 0) return;
  context.beginPath();
  context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
}

/** Query onset-sorted notes that overlap a time window. A maximum-end segment
 * tree skips expired sections without losing an earlier, long sustained note.
 * Build cost O(n), typical query O(log n + matches). */
export class NoteWindowIndex {
  constructor(notes) {
    this.notes = notes;
    this.size = 1;
    while (this.size < notes.length) this.size *= 2;
    this.maxEnd = new Float64Array(this.size * 2);
    this.maxEnd.fill(-Infinity);
    for (let i = 0; i < notes.length; i++) this.maxEnd[this.size + i] = notes[i].time + notes[i].duration;
    for (let i = this.size - 1; i > 0; i--) this.maxEnd[i] = Math.max(this.maxEnd[i * 2], this.maxEnd[i * 2 + 1]);
  }

  forEach(from, to, visit) {
    let low = 0, high = this.notes.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.notes[middle].time <= to) low = middle + 1; else high = middle;
    }
    const last = low;
    const walk = (node, first, end) => {
      if (first >= last || this.maxEnd[node] < from) return;
      if (end - first === 1) { visit(this.notes[first]); return; }
      const middle = (first + end) >>> 1;
      walk(node * 2, first, middle);
      walk(node * 2 + 1, middle, end);
    };
    if (last) walk(1, 0, this.size);
  }
}

/** A deterministic, resolution-independent Canvas2D piano and effects renderer.
 * The same render path powers the preview, screenshots and video recordings.
 * No user media leaves the browser. */
export class PianoRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.keys = new Map();
    this.layoutKey = '';
    this.colors = new Map();
    this.colorKey = '';
    this.effectEpoch = -Infinity;
    this.noteIndex = null;
    this.indexedNotes = null;
    this.indexedLength = 0;
  }

  resize(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.layoutKey = '';
    }
  }

  clearParticles() {
    // Effects are evaluated from the current song time, so seeking cannot leave
    // particles from another moment. There is no persistent particle buffer.
    this.effectEpoch = -Infinity;
  }

  noteColor(midi, track, settings) {
    const signature = `${settings.colorMode}:${settings.colorA}:${settings.colorB}`;
    if (signature !== this.colorKey) { this.colorKey = signature; this.colors.clear(); }
    const key = `${midi}:${track}`;
    if (!this.colors.has(key)) {
      const a = rgb(settings.colorA);
      const b = rgb(settings.colorB);
      let color;
      if (settings.colorMode === 'rainbow') color = rainbow((midi - 36) * 7 + 160);
      else if (settings.colorMode === 'track') color = track % 2 ? b : a;
      else if (settings.colorMode === 'single') color = a;
      else color = mix(a, b, clamp((midi - 42) / 44, 0, 1));
      this.colors.set(key, color);
    }
    return this.colors.get(key);
  }

  layout(settings, width) {
    const signature = `${width}:${settings.minNote}:${settings.maxNote}`;
    if (signature === this.layoutKey) return;
    this.layoutKey = signature;
    this.keys.clear();
    let whiteCount = 0;
    for (let midi = settings.minNote; midi <= settings.maxNote; midi++) if (!BLACK.has(midi % 12)) whiteCount++;
    // A partial range beginning/ending with a black key still gets usable edges.
    const leftInset = BLACK.has(settings.minNote % 12) ? 0.5 : 0;
    const rightInset = BLACK.has(settings.maxNote % 12) ? 0.5 : 0;
    const unit = width / (whiteCount + leftInset + rightInset);
    let whites = leftInset;
    for (let midi = settings.minNote; midi <= settings.maxNote; midi++) {
      const black = BLACK.has(midi % 12);
      const w = black ? unit * 0.64 : unit;
      const x = black ? whites * unit - w / 2 : whites * unit;
      this.keys.set(midi, { x, w, center: x + w / 2, black });
      if (!black) whites++;
    }
    this.keyWidth = unit;
  }

  render({ song, time, dt = 0, settings, liveNotes = [], background = null, playing = false }) {
    const c = this.ctx;
    if (!c) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (!width || !height) return;
    const scale = width / 1440;
    const keyHeight = settings.keyboard ? height * settings.keyboardHeight / 100 : height * 0.025;
    const strike = height - keyHeight;
    const speed = strike / settings.fallTime;
    this.layout(settings, width);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.shadowBlur = 0;
    c.fillStyle = settings.background;
    c.fillRect(0, 0, width, height);
    this.drawBackground(background, settings, width, height, strike, scale);

    const notes = song?.notes || [];
    const visible = [];
    const reactive = [];
    const active = new Map();
    if (this.indexedNotes !== notes || this.indexedLength !== notes.length) {
      this.noteIndex = new NoteWindowIndex(notes);
      this.indexedNotes = notes;
      this.indexedLength = notes.length;
    }
    this.noteIndex.forEach(time - 2, time + settings.fallTime, (note) => {
      if (!this.keys.has(note.midi)) return;
      const end = note.time + note.duration;
      if (end >= time && note.time <= time + settings.fallTime) visible.push(note);
      if (note.time <= time && end > time - 2) reactive.push(note);
      if (note.time <= time && end > time) active.set(note.midi, note);
    });
    for (const note of liveNotes) {
      if (!this.keys.has(note.midi)) continue;
      const end = note.time + note.duration;
      if (end > time - 2) reactive.push(note);
      if (end > time) {
        active.set(note.midi, note);
        // Live keys leave a growing column above the strike line.
        visible.push({ ...note, time: time - 0.02, duration: Math.min(2.5, Math.max(0.12, time - note.time)) });
      }
    }

    c.save();
    c.beginPath(); c.rect(0, 0, width, strike); c.clip();
    this.drawNotes(visible, time, speed, strike, scale, settings);
    this.drawRadiance(active, strike, height, scale, settings);
    if (settings.trails) this.drawRibbons(reactive, time, strike, height, scale, settings);
    if (settings.particles && settings.particleAmount > 0) this.drawParticles(reactive, time, strike, height, scale, settings);
    c.restore();
    if (settings.keyboard) this.drawKeyboard(active, strike, keyHeight, width, scale, settings);
    if (settings.saber) this.drawSaber(active, time, strike, width, scale, settings);
    c.shadowBlur = 0;
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  drawBackground(background, settings, width, height, strike, scale) {
    const c = this.ctx;
    if (background) {
      const sourceWidth = background.videoWidth || background.naturalWidth || background.width;
      const sourceHeight = background.videoHeight || background.naturalHeight || background.height;
      if (sourceWidth > 0 && sourceHeight > 0) {
        const ratio = Math.max(width / sourceWidth, height / sourceHeight);
        try { c.drawImage(background, (width - sourceWidth * ratio) / 2, (height - sourceHeight * ratio) / 2, sourceWidth * ratio, sourceHeight * ratio); } catch { /* Video may be between decoded frames. */ }
        c.fillStyle = `rgba(0,0,0,${settings.backgroundDim / 100})`;
        c.fillRect(0, 0, width, height);
      }
    } else {
      const aura = c.createRadialGradient(width * 0.5, strike, 0, width * 0.5, strike, width * 0.6);
      aura.addColorStop(0, rgba(rgb(settings.colorA), 0.027));
      aura.addColorStop(0.6, rgba(rgb(settings.colorB), 0.012));
      aura.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = aura; c.fillRect(0, 0, width, height);
      // Fixed stars stay still when playback is paused.
      for (let i = 0; i < 72; i++) {
        c.fillStyle = `rgba(174,195,220,${0.05 + hash(i * 3.9) * 0.15})`;
        const size = (0.35 + hash(i * 7.1) * 0.65) * Math.max(scale, 0.7);
        c.fillRect(hash(i + 4) * width, hash(i + 73) * strike * 0.96, size, size);
      }
    }
    if (settings.grid) {
      c.strokeStyle = 'rgba(180,198,229,0.065)'; c.lineWidth = Math.max(0.5, scale * 0.75);
      for (const [midi, key] of this.keys) {
        if (midi % 12 !== 0) continue;
        c.beginPath(); c.moveTo(key.x, 0); c.lineTo(key.x, strike); c.stroke();
      }
      for (let i = 1; i < 4; i++) {
        c.strokeStyle = 'rgba(180,198,229,0.022)';
        c.beginPath(); c.moveTo(0, strike * i / 4); c.lineTo(width, strike * i / 4); c.stroke();
      }
    }
    const vignette = c.createLinearGradient(0, 0, 0, strike);
    vignette.addColorStop(0, 'rgba(0,0,0,0.23)'); vignette.addColorStop(0.4, 'rgba(0,0,0,0)');
    c.fillStyle = vignette; c.fillRect(0, 0, width, strike);
  }

  drawNotes(notes, time, speed, strike, scale, settings) {
    const c = this.ctx;
    const glow = settings.glow / 100;
    for (const note of notes) {
      const key = this.keys.get(note.midi);
      const color = this.noteColor(note.midi, note.track || 0, settings);
      const bottom = strike - (note.time - time) * speed;
      const top = bottom - Math.max(7 * scale, note.duration * speed);
      const y = Math.max(-15 * scale, top);
      const h = Math.min(strike + 3 * scale, bottom) - y;
      if (h <= 0) continue;
      const w = key.w * (key.black ? 0.9 : 0.77);
      const x = key.center - w / 2;
      const radius = Math.min(6 * scale, w * 0.28);
      const nearTop = clamp((bottom + 30 * scale) / (strike * 0.3), 0.12, 1);
      c.globalAlpha = nearTop;
      c.shadowColor = rgba(color, 0.95); c.shadowBlur = glow * 23 * scale;
      const fill = c.createLinearGradient(x, y, x + w, y);
      if (settings.noteStyle === 'solid') {
        fill.addColorStop(0, rgba(color, 0.8)); fill.addColorStop(0.45, rgba(mix(color, [255,255,255], 0.32), 0.94)); fill.addColorStop(1, rgba(color, 0.7));
      } else {
        fill.addColorStop(0, rgba(color, 0.38)); fill.addColorStop(0.2, rgba(color, settings.noteStyle === 'outline' ? 0.025 : 0.13)); fill.addColorStop(0.75, rgba(color, settings.noteStyle === 'outline' ? 0.02 : 0.22)); fill.addColorStop(1, rgba(color, 0.48));
      }
      rounded(c, x, y, w, h, radius); c.fillStyle = fill; c.fill();
      c.strokeStyle = rgba(color, 0.38 * glow); c.lineWidth = Math.max(1.5, 4 * scale); c.stroke();
      c.strokeStyle = rgba(mix(color, [255,255,255], 0.3), 0.98); c.lineWidth = Math.max(1, 1.7 * scale); c.stroke();
      c.shadowBlur = 0;
      if (settings.noteStyle === 'glass' && h > 9 * scale) {
        rounded(c, x + 2 * scale, y + 2 * scale, w - 4 * scale, h - 4 * scale, radius * 0.7);
        c.strokeStyle = 'rgba(238,255,255,0.34)'; c.lineWidth = 0.8 * scale; c.stroke();
        const shine = c.createLinearGradient(x, y, x + w * 0.85, y + Math.min(h, 50 * scale));
        shine.addColorStop(0, 'rgba(255,255,255,0.32)'); shine.addColorStop(0.48, 'rgba(255,255,255,0)'); shine.addColorStop(1, rgba(color, 0.05));
        c.fillStyle = shine; c.fill();
        c.beginPath();
        c.moveTo(x + w * 0.2, y + Math.min(h * 0.25, 9 * scale));
        c.lineTo(x + w * 0.2, y + Math.min(h * 0.7, 34 * scale));
        c.strokeStyle = 'rgba(241,255,255,0.32)'; c.stroke();
      }
      if (settings.labels && h > 20 * scale && w > 11 * scale) {
        c.fillStyle = 'rgba(240,250,255,0.85)'; c.font = `${Math.max(7, Math.min(11 * scale, w * 0.62))}px system-ui`;
        c.textAlign = 'center'; c.textBaseline = 'bottom';
        c.fillText(PITCHES[note.midi % 12], key.center, Math.min(strike - 4 * scale, bottom - 5 * scale));
      }
    }
    c.globalAlpha = 1; c.shadowBlur = 0;
  }

  drawRadiance(active, strike, height, scale, settings) {
    if (settings.glow <= 0) return;
    const c = this.ctx;
    c.globalCompositeOperation = 'lighter';
    for (const [midi, note] of active) {
      const key = this.keys.get(midi);
      const color = this.noteColor(midi, note.track || 0, settings);
      const radius = Math.max(30 * scale, key.w * 2.6);
      const halo = c.createRadialGradient(key.center, strike, 0, key.center, strike, radius);
      halo.addColorStop(0, rgba(color, 0.85 * settings.glow / 100));
      halo.addColorStop(0.2, rgba(color, 0.24 * settings.glow / 100)); halo.addColorStop(1, rgba(color, 0));
      c.fillStyle = halo; c.fillRect(key.center - radius, strike - radius, radius * 2, radius * 2);
      const beam = c.createLinearGradient(0, strike, 0, strike - height * 0.3);
      beam.addColorStop(0, rgba(color, 0.055 * settings.glow / 100)); beam.addColorStop(1, rgba(color, 0));
      c.fillStyle = beam; c.fillRect(key.center - key.w * 0.8, strike - height * 0.3, key.w * 1.6, height * 0.3);
    }
    c.globalCompositeOperation = 'source-over';
  }

  drawRibbons(notes, time, strike, height, scale, settings) {
    const c = this.ctx;
    c.globalCompositeOperation = 'lighter';
    const turbulence = settings.turbulence / 100;
    for (const note of notes.slice(-30)) {
      const end = note.time + note.duration;
      const fade = clamp(1 - Math.max(0, time - end) / 0.9, 0, 1);
      if (!fade || time < note.time) continue;
      const key = this.keys.get(note.midi);
      const color = this.noteColor(note.midi, note.track || 0, settings);
      const extent = Math.min(height * 0.53, (time - note.time) * height * 0.5 + height * 0.11);
      const gradient = c.createLinearGradient(0, strike, 0, strike - extent);
      gradient.addColorStop(0, rgba(color, 0.16 * fade)); gradient.addColorStop(0.2, rgba(color, 0.65 * fade));
      gradient.addColorStop(0.7, rgba(color, 0.38 * fade)); gradient.addColorStop(1, rgba(color, 0));
      for (let strand = 0; strand < 3; strand++) {
        c.beginPath();
        for (let j = 0; j <= 45; j++) {
          const progress = j / 45;
          const curl = Math.sin(progress * 10.5 - time * 1.7 + note.midi * 0.7 + strand * 1.7);
          const bend = Math.sin(progress * 5 + time * 0.5 + note.midi) * progress;
          const x = key.center + (curl * (0.2 + progress) + bend * 1.4) * this.keyWidth * (0.5 + turbulence * 2) * progress;
          const y = strike - progress * extent;
          if (!j) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.strokeStyle = gradient; c.lineWidth = (strand ? 1.25 : 3.5) * scale;
        c.shadowColor = rgba(color, 0.8 * settings.glow / 100); c.shadowBlur = 12 * scale * settings.glow / 100;
        c.stroke();
      }
    }
    c.shadowBlur = 0; c.globalCompositeOperation = 'source-over';
  }

  drawParticles(notes, time, strike, height, scale, settings) {
    const c = this.ctx;
    const sources = notes.slice(-36);
    const perNote = Math.min(Math.floor(1800 / Math.max(1, sources.length)), Math.round(25 + settings.particleAmount * 2.7));
    const turbulence = settings.turbulence / 100;
    const rise = height * (0.2 + settings.particleSpeed * 0.004);
    c.globalCompositeOperation = 'lighter';
    for (const note of sources) {
      const key = this.keys.get(note.midi);
      const color = this.noteColor(note.midi, note.track || 0, settings);
      const seed = note.midi * 31 + note.time * 17;
      for (let i = 0; i < perNote; i++) {
        const n = seed + i * 2.37;
        const life = 0.7 + hash(n + 6) * 1.25;
        const age = ((time - note.time + hash(n) * life) % life + life) % life;
        const emittedAt = time - age;
        if (emittedAt < note.time || emittedAt > note.time + note.duration) continue;
        const progress = age / life;
        const spread = (hash(n + 2) - 0.5) * this.keyWidth * 0.75;
        const drift = (hash(n + 3) - 0.5) * this.keyWidth * age * (1 + turbulence * 3.5);
        const curl = Math.sin(age * 6.5 - time * 1.6 + note.midi * 0.7) * this.keyWidth * turbulence * age * 1.1;
        const x = key.center + spread + drift + curl;
        const y = strike - age * rise * (0.55 + hash(n + 4) * 0.45);
        const alpha = Math.pow(1 - progress, 1.2) * (0.4 + hash(n + 5) * 0.6) * Math.min(1, age * 12 + 0.6);
        const size = (0.8 + hash(n + 7) * 1.7) * Math.max(0.8, scale);
        c.fillStyle = rgba(i % 9 === 0 ? mix(color, [255,255,255], 0.6) : color, alpha);
        if (i % 11 === 0) {
          c.strokeStyle = rgba(color, alpha * 0.65); c.lineWidth = size * 0.6;
          c.beginPath(); c.moveTo(x, y); c.lineTo(x - drift * 0.04, y + (3 + age * 4) * scale); c.stroke();
        } else c.fillRect(x, y, size, size);
      }
    }
    c.globalCompositeOperation = 'source-over';
  }

  drawKeyboard(active, strike, keyHeight, width, scale, settings) {
    const c = this.ctx;
    c.fillStyle = '#080a0e'; c.fillRect(0, strike, width, keyHeight);
    for (const [midi, key] of this.keys) {
      if (key.black) continue;
      const note = active.get(midi);
      const color = note ? this.noteColor(midi, note.track || 0, settings) : null;
      const gradient = c.createLinearGradient(0, strike, 0, strike + keyHeight);
      if (color) {
        gradient.addColorStop(0, rgba(mix(color, [255,255,255], 0.62), 1));
        gradient.addColorStop(0.35, rgba(mix(color, [217,229,243], 0.55), 1));
        gradient.addColorStop(1, rgba(mix(color, [165,178,197], 0.72), 1));
      } else {
        gradient.addColorStop(0, '#939ca9'); gradient.addColorStop(0.1, '#d6dbe3'); gradient.addColorStop(0.75, '#e6e8ee'); gradient.addColorStop(1, '#b6bdc9');
      }
      c.fillStyle = gradient;
      rounded(c, key.x + Math.max(0.45, scale * 0.75), strike + 1, key.w - Math.max(0.9, scale * 1.5), keyHeight - 5 * scale, 2.8 * scale); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(key.x + key.w - 2 * scale, strike + keyHeight * 0.64, Math.max(0.5, scale * 0.65), keyHeight * 0.29);
      if (settings.labels && midi % 12 === 0) {
        c.fillStyle = 'rgba(32,41,56,0.55)'; c.font = `${Math.max(6, 9 * scale)}px system-ui`;
        c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(`C${Math.floor(midi / 12) - 1}`, key.center, strike + keyHeight - 13 * scale);
      }
    }
    for (const [midi, key] of this.keys) {
      if (!key.black) continue;
      const note = active.get(midi);
      const color = note ? this.noteColor(midi, note.track || 0, settings) : null;
      const blackHeight = keyHeight * 0.63;
      c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 3 * scale; c.shadowOffsetX = 1.5 * scale; c.shadowOffsetY = 3 * scale;
      const gradient = c.createLinearGradient(key.x, strike, key.x + key.w, strike + blackHeight);
      gradient.addColorStop(0, color ? rgba(mix(color, [15,20,30], 0.4), 1) : '#303745');
      gradient.addColorStop(0.25, color ? rgba(mix(color, [15,20,30], 0.75), 1) : '#10141c');
      gradient.addColorStop(0.8, '#090c12'); gradient.addColorStop(1, '#242a35');
      c.fillStyle = gradient; rounded(c, key.x, strike, key.w, blackHeight, 2 * scale); c.fill();
      c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
      c.strokeStyle = color ? rgba(color, 0.45) : 'rgba(150,164,186,0.15)'; c.lineWidth = Math.max(0.5, scale * 0.7);
      c.beginPath(); c.moveTo(key.x + 1.5 * scale, strike + 2 * scale); c.lineTo(key.x + 1.5 * scale, strike + blackHeight - 5 * scale); c.lineTo(key.x + key.w - 1.5 * scale, strike + blackHeight - 5 * scale); c.stroke();
    }
    c.fillStyle = 'rgba(5,8,14,0.65)'; c.fillRect(0, strike, width, Math.max(1, scale * 2));
    const rail = c.createLinearGradient(0, strike + keyHeight - 5 * scale, 0, strike + keyHeight);
    rail.addColorStop(0, '#424854'); rail.addColorStop(0.4, '#191d27'); rail.addColorStop(1, '#080a0f');
    c.fillStyle = rail; c.fillRect(0, strike + keyHeight - 5 * scale, width, 5 * scale);
  }

  drawSaber(active, time, strike, width, scale, settings) {
    const c = this.ctx;
    const gradient = c.createLinearGradient(0, 0, width, 0);
    if (settings.colorMode === 'rainbow') {
      for (let i = 0; i <= 6; i++) gradient.addColorStop(i / 6, rgba(rainbow(160 + i * 40), 0.7));
    } else {
      gradient.addColorStop(0, rgba(rgb(settings.colorA), 0.55)); gradient.addColorStop(1, rgba(rgb(settings.colorMode === 'single' ? settings.colorA : settings.colorB), 0.55));
    }
    c.save(); c.globalCompositeOperation = 'lighter';
    c.shadowBlur = settings.glow * 0.28 * scale; c.shadowColor = settings.colorA;
    c.strokeStyle = gradient; c.lineWidth = Math.max(1, 2 * scale);
    c.beginPath();
    const activeKeys = [...active.keys()].map((midi) => this.keys.get(midi).center);
    const step = Math.max(3, 5 * scale);
    for (let x = 0; x <= width + step; x += step) {
      let amp = 0.55;
      for (const center of activeKeys) amp += 2.4 * Math.exp(-Math.pow((x - center) / (26 * scale), 2));
      const y = strike - 1 * scale - (Math.sin(x / (17 * scale) + time * 3) + Math.sin(x / (7 * scale) - time * 4) * 0.3) * amp * scale;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    c.shadowBlur = 0; c.lineWidth = Math.max(0.5, scale * 0.65); c.strokeStyle = 'rgba(234,255,255,0.45)'; c.stroke();
    for (const [midi, note] of active) {
      const key = this.keys.get(midi);
      const color = this.noteColor(midi, note.track || 0, settings);
      c.shadowBlur = 14 * scale * settings.glow / 100; c.shadowColor = rgba(color, 1);
      c.fillStyle = 'rgba(241,255,255,0.9)'; c.fillRect(key.center - key.w * 0.45, strike - 1.5 * scale, key.w * 0.9, 2.5 * scale);
    }
    c.restore();
  }
}
