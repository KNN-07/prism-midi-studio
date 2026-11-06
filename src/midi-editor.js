import { addNote, deleteNote, editNote, noteName, snapTime, MAX_EDIT_TIME } from './midi-edit.js';
import { getNoteIndex } from './note-index.js';

const KEY_WIDTH = 54, RULER_HEIGHT = 28, ROW_HEIGHT = 20;
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const TRACK_COLORS = ['#a9e9d0', '#b5b3f5', '#efbb91', '#91cbe8', '#e4a7d5', '#d5df96'];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** A small, local piano roll. Song snapshots stay immutable for shared indexes. */
export class MidiEditor {
  constructor(root, callbacks = {}) {
    this.root = root;
    this.callbacks = callbacks;
    this.song = null;
    this.selected = -1;
    this.time = 0;
    this.scale = 90;
    this.filter = -1;
    this.active = false;
    this.disabled = false;
    this.drawMode = false;
    this.undoStack = [];
    this.redoStack = [];
    this.drag = null;
    this.frame = null;
    this.visibleNotes = [];
    root.classList.add('midi-editor');
    root.innerHTML = `
      <div class="midi-editor-heading"><div><h2>Quick MIDI editor</h2><p>A few small changes. A performance that feels right.</p></div><button type="button" class="btn primary" data-action="download" title="Export notes and tracks at a constant tempo. Original tempo changes and MIDI controllers are not retained.">Download MIDI</button></div>
      <div class="midi-tools">
        <div class="midi-tool-group"><button type="button" class="btn" data-action="add">+ Add note</button><button type="button" class="btn" data-action="draw" aria-pressed="false">Draw notes</button><button type="button" class="btn" data-action="delete" title="Delete selected note (Delete)">Delete</button></div>
        <div class="midi-tool-group"><button type="button" class="btn" data-action="undo" title="Undo (Ctrl / ⌘ Z)">Undo</button><button type="button" class="btn" data-action="redo" title="Redo (Ctrl / ⌘ Shift Z)">Redo</button></div>
        <label>Track<select data-control="track" aria-label="MIDI editor track"><option value="-1">All tracks</option></select></label>
        <label>Snap<select data-control="snap" aria-label="Note snap"><option value="0">Off</option><option value="1">1 beat</option><option value="0.5">½ beat</option><option value="0.25" selected>¼ beat</option><option value="0.125">⅛ beat</option></select></label>
        <label>Zoom<select data-control="zoom" aria-label="Piano roll zoom"><option value="45">50%</option><option value="90" selected>100%</option><option value="180">200%</option><option value="360">400%</option></select></label>
        <button type="button" class="btn" data-action="playhead">Go to playhead</button>
      </div>
      <div class="midi-roll" data-roll><div class="midi-roll-space" data-space><canvas tabindex="0" aria-label="Piano roll. Double-click to add a note. Select and drag to move, drag the right edge to resize. Arrow keys move the selected note; Delete removes it." aria-describedby="midi-roll-help"></canvas></div></div>
      <div class="midi-roll-caption"><span data-summary></span><span data-snap-caption>Time in seconds</span></div>
      <form class="midi-properties" data-properties>
        <div class="midi-selection"><span class="eyebrow">Selected note</span><div class="midi-note-stepper"><strong data-selection aria-live="polite">Choose a note</strong><button type="button" data-action="previous" aria-label="Select previous note" title="Select previous note">‹</button><button type="button" data-action="next" aria-label="Select next note" title="Select next note">›</button></div></div>
        <label>Pitch (MIDI)<input type="number" name="midi" min="0" max="127" step="1" required aria-label="Selected note MIDI pitch"></label>
        <label>Start (seconds)<input type="number" name="time" min="0" max="${MAX_EDIT_TIME}" step="any" required aria-label="Selected note start in seconds"></label>
        <label>Length (seconds)<input type="number" name="duration" min="0.001" max="${MAX_EDIT_TIME}" step="any" required aria-label="Selected note duration in seconds"></label>
        <label>Velocity<input type="number" name="velocity" min="1" max="127" step="1" required aria-label="Selected note velocity"></label>
        <button class="btn" type="submit" data-action="apply">Apply</button>
      </form>
      <p class="midi-help" id="midi-roll-help">Double-click to add · drag to move · drag a note’s right edge to resize. Select a note to edit exact values below. Scroll for more pitches and time.</p>
      <p class="midi-save-note" data-save-note role="status">Edits stay in this session. Download MIDI to keep your changes.</p>`;
    this.viewport = root.querySelector('[data-roll]');
    this.space = root.querySelector('[data-space]');
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.form = root.querySelector('form');
    this.buttons = Object.fromEntries([...root.querySelectorAll('[data-action]')].map(el => [el.dataset.action, el]));
    this.trackSelect = root.querySelector('[data-control="track"]');
    this.snapSelect = root.querySelector('[data-control="snap"]');
    this.zoomSelect = root.querySelector('[data-control="zoom"]');
    this.buttons.add.onclick = () => this.insertNote(this.time, this.song?.notes[this.selected]?.midi ?? 60);
    this.buttons.draw.onclick = () => {
      if (this.disabled) return;
      this.drawMode = !this.drawMode;
      this.buttons.draw.setAttribute('aria-pressed', String(this.drawMode));
      this.canvas.style.cursor = this.drawMode ? 'crosshair' : 'default';
    };
    this.buttons.delete.onclick = () => this.removeSelected();
    this.buttons.previous.onclick = () => this.selectNext(-1);
    this.buttons.next.onclick = () => this.selectNext(1);
    this.buttons.undo.onclick = () => this.undo();
    this.buttons.redo.onclick = () => this.redo();
    this.buttons.download.onclick = () => {
      if (this.song?.notes.length) this.callbacks.onDownload?.(this.song);
    };
    this.buttons.playhead.onclick = () => this.showTime(this.time);
    this.trackSelect.onchange = () => {
      this.cancelDrag();
      this.filter = Number(this.trackSelect.value);
      if (this.selected >= 0 && this.filter >= 0 && this.song.notes[this.selected].track !== this.filter) this.selected = -1;
      this.updateControls(); this.requestDraw();
    };
    this.snapSelect.onchange = () => { this.updateCaption(); this.requestDraw(); };
    this.zoomSelect.onchange = () => {
      this.cancelDrag();
      const leftTime = this.viewport.scrollLeft / this.scale;
      this.scale = Number(this.zoomSelect.value);
      this.resize(); this.viewport.scrollLeft = leftTime * this.scale;
    };
    this.form.onsubmit = event => {
      event.preventDefault();
      if (this.disabled || this.selected < 0 || !this.form.reportValidity()) return;
      const fields = this.form.elements;
      const note = this.song.notes[this.selected], patch = {};
      // Only submit changed fields: imported pedal tails retain their original
      // key-down length when a user changes pitch, start, or velocity.
      for (const key of ['midi', 'time', 'duration']) {
        const value = Number(fields[key].value);
        if (value !== Number(note[key].toFixed(6))) patch[key] = value;
      }
      if (Number(fields.velocity.value) !== Math.round(note.velocity * 127)) patch.velocity = Number(fields.velocity.value) / 127;
      this.changeNote(this.selected, patch);
    };
    this.viewport.addEventListener('scroll', () => this.requestDraw(), { passive: true });
    this.canvas.addEventListener('pointerdown', event => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', event => this.pointerMove(event));
    this.canvas.addEventListener('pointerup', event => this.pointerUp(event));
    this.canvas.addEventListener('pointercancel', () => this.cancelDrag());
    this.canvas.addEventListener('lostpointercapture', () => this.cancelDrag());
    this.canvas.addEventListener('dblclick', event => {
      if (this.disabled || this.drawMode || !this.song) return;
      const point = this.point(event);
      if (point.x >= KEY_WIDTH && point.y >= RULER_HEIGHT && !this.hitNote(point)) this.insertNote(point.time, point.midi);
    });
    root.addEventListener('keydown', event => this.keyDown(event));
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.viewport);
    this.updateControls();
  }

  setSong(song, { resetHistory = false } = {}) {
    this.cancelDrag();
    this.song = song;
    this.selected = -1;
    if (resetHistory || !this.initialSong) {
      this.initialSong = song;
      this.undoStack = []; this.redoStack = [];
      this.filter = -1;
      this.viewport.scrollLeft = 0;
      this.centerPending = true;
    }
    this.refreshTracks(); this.updateControls(); this.resize();
  }

  setTime(time) {
    if (this.time === time) return;
    this.time = time;
    this.requestDraw();
  }

  setActive(active) {
    this.active = active;
    if (active) this.resize(); else this.cancelDrag();
  }

  setDisabled(disabled) {
    this.disabled = disabled;
    if (disabled) this.cancelDrag();
    this.updateControls();
  }

  get snap() { return Number(this.snapSelect.value) * 60 / (this.song?.bpm || 120); }

  refreshTracks() {
    this.trackSelect.replaceChildren(new Option('All tracks', '-1'));
    this.song?.tracks?.forEach((track, index) => this.trackSelect.add(new Option(track.name || `Track ${index + 1}`, String(index))));
    if (this.filter >= (this.song?.tracks?.length || 0)) this.filter = -1;
    this.trackSelect.value = String(this.filter);
  }

  updateCaption() {
    this.root.querySelector('[data-snap-caption]').textContent = Number(this.snapSelect.value) ? `Seconds · snap at ${Math.round(this.song?.bpm || 120)} BPM (initial tempo)` : 'Time in seconds · snap off';
  }

  updateControls() {
    const note = this.song?.notes[this.selected];
    this.root.querySelector('[data-selection]').textContent = note ? `${noteName(note.midi)} · track ${note.track + 1}` : 'Choose a note';
    for (const input of this.form.querySelectorAll('input')) input.disabled = this.disabled || !note;
    this.buttons.apply.disabled = this.disabled || !note;
    this.buttons.delete.disabled = this.disabled || !note;
    this.buttons.add.disabled = this.disabled || !this.song;
    this.buttons.draw.disabled = this.disabled || !this.song;
    this.buttons.undo.disabled = this.disabled || !this.undoStack.length;
    this.buttons.redo.disabled = this.disabled || !this.redoStack.length;
    this.buttons.download.disabled = !this.song?.notes.length;
    const hasVisibleNotes = this.filter < 0 ? !!this.song?.notes.length : this.song?.notes.some(note => note.track === this.filter);
    this.buttons.previous.disabled = !hasVisibleNotes;
    this.buttons.next.disabled = !hasVisibleNotes;
    if (note) {
      this.form.elements.midi.value = note.midi;
      this.form.elements.time.value = Number(note.time.toFixed(6));
      this.form.elements.duration.value = Number(note.duration.toFixed(6));
      this.form.elements.velocity.value = Math.round(note.velocity * 127);
    } else for (const input of this.form.querySelectorAll('input')) input.value = '';
    this.root.querySelector('[data-summary]').textContent = `${(this.song?.notes.length || 0).toLocaleString()} notes${this.filter >= 0 ? ` · showing track ${this.filter + 1}` : ' · all tracks'}`;
    this.root.querySelector('[data-save-note]').textContent = this.disabled ? 'Recording in progress. Editing will be available when it finishes.' : this.song !== this.initialSong ? 'Unsaved MIDI changes · download MIDI to keep your edits. Importing or reloading replaces this session.' : 'Edits stay in this session. Download MIDI to keep your changes.';
    this.canvas.setAttribute('aria-disabled', String(this.disabled));
    this.updateCaption();
  }

  commit(next, selected = -1) {
    if (this.disabled || !next || next === this.song) return;
    this.cancelDrag();
    this.undoStack.push({ song: this.song, selected: this.selected });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this.song = next; this.selected = selected;
    this.afterChange();
  }

  afterChange() {
    this.refreshTracks(); this.updateControls(); this.resize();
    this.revealSelected();
    this.callbacks.onChange?.(this.song);
  }

  changeNote(index, patch) {
    if (this.disabled || !this.song) return;
    const note = this.song.notes[index];
    patch = Object.fromEntries(Object.entries(patch).filter(([key, value]) => note && value !== note[key]));
    if (!Object.keys(patch).length) return;
    if (('time' in patch || 'duration' in patch) && (patch.time ?? note.time) + (patch.duration ?? note.duration) > MAX_EDIT_TIME) {
      this.callbacks.onError?.('Keep the note’s end within 24 hours (86,400 seconds).'); return;
    }
    const next = editNote(this.song, index, patch);
    if (next === this.song) return;
    const existing = new Set(this.song.notes);
    this.commit(next, next.notes.findIndex(note => !existing.has(note)));
  }

  insertNote(time, midi) {
    if (this.disabled || !this.song) return;
    const selected = this.song.notes[this.selected];
    const track = this.filter >= 0 ? this.filter : selected?.track ?? this.song.notes[0]?.track ?? 0;
    const channel = this.song.notes.find(note => note.track === track)?.channel ?? track % 16;
    const next = addNote(this.song, { time: snapTime(time, this.snap), midi, duration: Math.max(.01, this.snap || .25), velocity: selected?.velocity ?? .75, track, channel });
    if (next === this.song) { this.callbacks.onError?.('Add notes within the first 24 hours of the performance.'); return; }
    const existing = new Set(this.song.notes);
    this.commit(next, next.notes.findIndex(note => !existing.has(note)));
  }

  removeSelected() {
    if (!this.disabled && this.selected >= 0) this.commit(deleteNote(this.song, this.selected));
  }

  selectNext(direction) {
    if (!this.song?.notes.length) return;
    this.cancelDrag();
    const count = this.song.notes.length;
    let index = this.selected >= 0 ? this.selected : direction > 0 ? -1 : 0;
    for (let step = 0; step < count; step++) {
      index = (index + direction + count) % count;
      if (this.filter < 0 || this.song.notes[index].track === this.filter) {
        this.selected = index; this.updateControls(); this.revealSelected(); this.requestDraw(); return;
      }
    }
  }

  undo() {
    if (this.disabled || !this.undoStack.length) return;
    this.cancelDrag();
    this.redoStack.push({ song: this.song, selected: this.selected });
    const previous = this.undoStack.pop();
    this.song = previous.song; this.selected = previous.selected; this.afterChange();
  }

  redo() {
    if (this.disabled || !this.redoStack.length) return;
    this.cancelDrag();
    this.undoStack.push({ song: this.song, selected: this.selected });
    const next = this.redoStack.pop();
    this.song = next.song; this.selected = next.selected; this.afterChange();
  }

  showTime(time) {
    this.viewport.scrollLeft = Math.max(0, time * this.scale - (this.viewport.clientWidth - KEY_WIDTH) / 3);
    this.requestDraw();
  }

  revealSelected() {
    const note = this.song?.notes[this.selected];
    if (!note || !this.active) return;
    const x = note.time * this.scale, y = (127 - note.midi) * ROW_HEIGHT;
    if (x < this.viewport.scrollLeft || x > this.viewport.scrollLeft + this.viewport.clientWidth - KEY_WIDTH - 15) this.showTime(note.time);
    if (y < this.viewport.scrollTop || y + ROW_HEIGHT > this.viewport.scrollTop + this.viewport.clientHeight - RULER_HEIGHT) this.viewport.scrollTop = Math.max(0, y - (this.viewport.clientHeight - RULER_HEIGHT) / 2);
  }

  resize() {
    if (!this.active || !this.song || !this.viewport.clientWidth) return;
    const width = this.viewport.clientWidth, height = this.viewport.clientHeight;
    this.space.style.width = `${Math.max(width, KEY_WIDTH + (this.song.duration + 4) * this.scale)}px`;
    this.space.style.height = `${RULER_HEIGHT + 128 * ROW_HEIGHT}px`;
    this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    if (this.centerPending) {
      let low = 127, high = 0;
      for (const note of this.song.notes) { low = Math.min(low, note.midi); high = Math.max(high, note.midi); }
      const center = this.song.notes.length ? (low + high) / 2 : 60;
      this.viewport.scrollTop = Math.max(0, (127 - center) * ROW_HEIGHT - (height - RULER_HEIGHT) / 2);
      this.centerPending = false;
    }
    this.requestDraw();
  }

  requestDraw() {
    if (!this.active || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; if (this.active) this.draw(); });
  }

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    return { x, y, time: Math.max(0, (x - KEY_WIDTH + this.viewport.scrollLeft) / this.scale), midi: clamp(127 - Math.floor((y - RULER_HEIGHT + this.viewport.scrollTop) / ROW_HEIGHT), 0, 127) };
  }

  hitNote(point) {
    if (point.x < KEY_WIDTH || point.y < RULER_HEIGHT) return null;
    for (let i = this.visibleNotes.length - 1; i >= 0; i--) {
      const hit = this.visibleNotes[i];
      if (point.x >= hit.x && point.x <= hit.x + hit.width && point.y >= hit.y && point.y <= hit.y + ROW_HEIGHT - 3) return hit;
    }
    return null;
  }

  pointerDown(event) {
    if (event.button !== 0 || !this.song) return;
    const point = this.point(event);
    if (point.y < RULER_HEIGHT && point.x >= KEY_WIDTH) { this.callbacks.onSeek?.(Math.min(this.song.duration, point.time)); return; }
    if (point.x < KEY_WIDTH || point.y < RULER_HEIGHT || this.disabled) return;
    event.preventDefault(); this.canvas.focus({ preventScroll: true });
    const hit = this.hitNote(point);
    if (hit) {
      this.selected = hit.index;
      const note = this.song.notes[hit.index];
      this.drag = { pointerId: event.pointerId, index: hit.index, note, start: point, mode: point.x >= hit.x + hit.width - Math.min(8, hit.width / 3) ? 'resize' : 'move', patch: null };
      this.canvas.setPointerCapture(event.pointerId);
    } else {
      this.selected = -1;
      if (this.drawMode) this.insertNote(point.time, point.midi);
    }
    this.updateControls(); this.requestDraw();
  }

  pointerMove(event) {
    const point = this.point(event);
    if (!this.drag) {
      const hit = this.hitNote(point);
      this.canvas.style.cursor = this.disabled ? 'default' : hit ? (point.x >= hit.x + hit.width - Math.min(8, hit.width / 3) ? 'ew-resize' : 'grab') : this.drawMode ? 'crosshair' : 'default';
      return;
    }
    if (event.pointerId !== this.drag.pointerId || this.disabled) return;
    const { note, start, mode } = this.drag;
    if (!this.drag.patch && Math.abs(point.x - start.x) + Math.abs(point.y - start.y) < 3) return;
    if (mode === 'resize') {
      const end = snapTime(note.time + note.duration + point.time - start.time, this.snap);
      this.drag.patch = { duration: Math.max(.01, end - note.time) };
    } else this.drag.patch = { time: snapTime(note.time + point.time - start.time, this.snap), midi: clamp(note.midi + point.midi - start.midi, 0, 127) };
    this.requestDraw();
  }

  pointerUp(event) {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const { index, patch } = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (patch) this.changeNote(index, patch);
    this.requestDraw();
  }

  cancelDrag() {
    if (!this.drag) return;
    const pointerId = this.drag.pointerId;
    this.drag = null;
    if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    this.requestDraw();
  }

  keyDown(event) {
    if (event.target.matches('input, select, textarea')) return;
    // Space still plays from the roll, while focused buttons keep their
    // native keyboard activation instead of triggering global transport.
    if (event.code === 'Space' && event.target.closest('button')) { event.stopPropagation(); return; }
    const command = event.ctrlKey || event.metaKey;
    if (command && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation();
      if (event.key.toLowerCase() === 'y' || event.shiftKey) this.redo(); else this.undo();
      return;
    }
    if (event.key === 'Escape') { this.cancelDrag(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation(); this.removeSelected(); return;
    }
    if (event.target !== this.canvas || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const note = this.song?.notes[this.selected];
    if (!note || this.disabled) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') this.changeNote(this.selected, { midi: note.midi + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 12 : 1) });
    else this.changeNote(this.selected, { time: Math.max(0, note.time + (event.key === 'ArrowRight' ? 1 : -1) * (this.snap || .01)) });
  }

  draw() {
    if (!this.song) return;
    const ctx = this.ctx, width = this.viewport.clientWidth, height = this.viewport.clientHeight;
    if (!width || !height) return;
    ctx.setTransform(this.canvas.width / width, 0, 0, this.canvas.height / height, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#12161d'; ctx.fillRect(0, 0, width, height);
    const left = this.viewport.scrollLeft, top = this.viewport.scrollTop;
    const firstRow = Math.max(0, Math.floor(top / ROW_HEIGHT)), lastRow = Math.min(127, Math.ceil((top + height - RULER_HEIGHT) / ROW_HEIGHT));
    ctx.save(); ctx.beginPath(); ctx.rect(KEY_WIDTH, RULER_HEIGHT, width - KEY_WIDTH, height - RULER_HEIGHT); ctx.clip();
    for (let row = firstRow; row <= lastRow; row++) {
      const pitch = 127 - row, y = RULER_HEIGHT + row * ROW_HEIGHT - top;
      ctx.fillStyle = BLACK_KEYS.has(pitch % 12) ? '#131820' : '#191f27'; ctx.fillRect(KEY_WIDTH, y, width - KEY_WIDTH, ROW_HEIGHT);
      ctx.fillStyle = pitch % 12 === 0 ? '#3b4653' : '#242b34'; ctx.fillRect(KEY_WIDTH, y + ROW_HEIGHT - 1, width - KEY_WIDTH, 1);
    }
    const from = Math.max(0, left / this.scale), to = (left + width - KEY_WIDTH) / this.scale;
    const gridStep = this.snap > 0 ? this.snap : (this.scale >= 180 ? .25 : this.scale >= 90 ? .5 : 1);
    const gridStride = Math.max(1, Math.ceil(8 / (gridStep * this.scale)));
    for (let value = Math.ceil(from / (gridStep * gridStride)) * gridStep * gridStride; value <= to; value += gridStep * gridStride) {
      const x = KEY_WIDTH + value * this.scale - left;
      ctx.fillStyle = '#29323c'; ctx.fillRect(Math.round(x), RULER_HEIGHT, 1, height);
    }
    this.visibleNotes = [];
    const selected = this.selected;
    const paintNote = (note, index) => {
      if (this.filter >= 0 && note.track !== this.filter) return;
      const display = this.drag?.index === index && this.drag.patch ? { ...note, ...this.drag.patch } : note;
      const x = KEY_WIDTH + display.time * this.scale - left, y = RULER_HEIGHT + (127 - display.midi) * ROW_HEIGHT - top + 2;
      const noteWidth = Math.max(5, display.duration * this.scale);
      if (x > width || x + noteWidth < KEY_WIDTH || y > height || y + ROW_HEIGHT < RULER_HEIGHT) return;
      const color = TRACK_COLORS[(display.track || 0) % TRACK_COLORS.length];
      ctx.globalAlpha = index === selected ? 1 : .42 + display.velocity * .48;
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, noteWidth, ROW_HEIGHT - 4, 3); ctx.fill(); ctx.globalAlpha = 1;
      if (index === selected) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (noteWidth > 26) { ctx.fillStyle = '#142921'; ctx.font = '10px system-ui, sans-serif'; ctx.fillText(noteName(display.midi), Math.max(KEY_WIDTH + 3, x + 4), y + 11, Math.max(1, Math.min(noteWidth - 9, x + noteWidth - KEY_WIDTH - 6))); }
      if (index === selected && noteWidth > 12) { ctx.fillStyle = '#24463c'; ctx.fillRect(x + noteWidth - 4, y + 4, 1, ROW_HEIGHT - 12); }
      this.visibleNotes.push({ index, x, y, width: noteWidth });
    };
    getNoteIndex(this.song.notes).forEach(from, to, (note, index) => { if (index !== selected) paintNote(note, index); });
    if (selected >= 0) paintNote(this.song.notes[selected], selected);
    ctx.restore();
    ctx.fillStyle = '#1c232c'; ctx.fillRect(0, RULER_HEIGHT, KEY_WIDTH, height - RULER_HEIGHT);
    ctx.save(); ctx.beginPath(); ctx.rect(0, RULER_HEIGHT, KEY_WIDTH, height - RULER_HEIGHT); ctx.clip();
    ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right';
    for (let row = firstRow; row <= lastRow; row++) {
      const pitch = 127 - row, y = RULER_HEIGHT + row * ROW_HEIGHT - top;
      ctx.fillStyle = BLACK_KEYS.has(pitch % 12) ? '#10151c' : '#222b35'; ctx.fillRect(0, y, KEY_WIDTH - 1, ROW_HEIGHT - 1);
      ctx.fillStyle = pitch % 12 === 0 ? '#b2efd6' : '#8894a3'; ctx.fillText(noteName(pitch), KEY_WIDTH - 9, y + 14);
    }
    ctx.restore();
    ctx.fillStyle = '#202731'; ctx.fillRect(0, 0, width, RULER_HEIGHT);
    ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#7d8998'; ctx.fillText('NOTE', 9, 18);
    ctx.save(); ctx.beginPath(); ctx.rect(KEY_WIDTH, 0, width - KEY_WIDTH, height); ctx.clip();
    const rulerStep = this.scale >= 90 ? 1 : 2;
    for (let second = Math.ceil(from / rulerStep) * rulerStep; second <= to; second += rulerStep) {
      const x = KEY_WIDTH + second * this.scale - left;
      ctx.fillStyle = '#9ba7b7'; ctx.fillText(`${second}s`, x + 5, 18); ctx.fillStyle = '#3b4654'; ctx.fillRect(x, 20, 1, 8);
    }
    const playX = KEY_WIDTH + this.time * this.scale - left;
    if (playX >= KEY_WIDTH && playX <= width) { ctx.fillStyle = '#f5d58d'; ctx.fillRect(Math.round(playX), 0, 1, height); ctx.beginPath(); ctx.moveTo(playX - 4, 0); ctx.lineTo(playX + 5, 0); ctx.lineTo(playX, 7); ctx.fill(); }
    ctx.restore();
    if (!this.song.notes.length) { ctx.fillStyle = '#a0afbf'; ctx.textAlign = 'center'; ctx.font = '13px system-ui, sans-serif'; ctx.fillText('Double-click the grid or choose Add note to begin.', (width + KEY_WIDTH) / 2, height / 2, width - KEY_WIDTH - 24); ctx.textAlign = 'left'; }
  }
}
