const PITCH_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const NUMERIC_FIELDS = ['midi', 'time', 'duration', 'velocity', 'track', 'channel'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const MAX_EDIT_TIME = 86400;

/** MIDI 60 is middle C (C4). Invalid pitches have no display name. */
export function noteName(midi) {
  if (!Number.isFinite(midi)) return '—';
  const pitch = clamp(Math.round(midi), 0, 127);
  return `${PITCH_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

/** Snap a time in seconds. A zero/invalid step disables snapping. */
export function snapTime(seconds, stepSeconds) {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) return time;
  // Avoid decimal noise when a snapped value is displayed in a number input.
  return Number((Math.round(time / stepSeconds) * stepSeconds).toFixed(9));
}

function normalizeNote(base, patch, adding = false) {
  if (!patch || typeof patch !== 'object') return null;
  for (const key of NUMERIC_FIELDS) {
    if (Object.hasOwn(patch, key) && !Number.isFinite(patch[key])) return null;
  }
  for (const key of ['time', 'duration']) {
    if (Object.hasOwn(patch, key) && patch[key] > MAX_EDIT_TIME) return null;
  }
  const note = { ...base };
  for (const key of NUMERIC_FIELDS) if (Object.hasOwn(patch, key)) note[key] = patch[key];
  note.midi = clamp(Math.round(note.midi), 0, 127);
  note.time = Math.max(0, note.time);
  if (adding || Object.hasOwn(patch, 'duration')) note.duration = Math.max(.001, note.duration);
  if (adding || Object.hasOwn(patch, 'time') || Object.hasOwn(patch, 'duration')) {
    const end = note.time + note.duration;
    if (!Number.isFinite(end) || end > MAX_EDIT_TIME) return null;
  }
  note.velocity = clamp(note.velocity, 1 / 127, 1);
  note.track = clamp(Math.round(note.track ?? 0), 0, 4095);
  note.channel = clamp(Math.round(note.channel ?? note.track % 16), 0, 15);
  // Imported notes can have a shorter key-down time because of sustain. Keep
  // it on pitch/time/velocity changes; explicitly resizing sets a new release.
  if (adding || Object.hasOwn(patch, 'duration')) note.keyDuration = note.duration;
  return note;
}

function withNotes(song, notes) {
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi || a.track - b.track);
  const tracks = (song.tracks || []).map(track => ({ ...track, count: 0 }));
  let duration = Math.max(1, Number.isFinite(song.duration) ? song.duration : 0);
  for (const note of notes) {
    const track = note.track ?? 0;
    while (tracks.length <= track) tracks.push({ name: `Track ${tracks.length + 1}`, count: 0 });
    tracks[track].count++;
    duration = Math.max(duration, note.time + note.duration);
  }
  return { ...song, notes, tracks, duration };
}

/** Immutable note edit. Invalid fields or timing beyond 24 hours leave song
 * unchanged. Pitch/velocity edits preserve timing of longer imported notes. */
export function editNote(song, index, patch) {
  if (!Number.isInteger(index) || index < 0 || index >= song.notes.length) return song;
  const note = normalizeNote(song.notes[index], patch);
  if (!note) return song;
  const notes = song.notes.slice();
  notes[index] = note;
  return withNotes(song, notes);
}

/** Add a note, using piano defaults for omitted fields; invalid fields are ignored as an operation. */
export function addNote(song, note = {}) {
  const next = normalizeNote({ midi: 60, time: 0, duration: .5, velocity: .75, track: 0 }, note, true);
  return next ? withNotes(song, [...song.notes, next]) : song;
}

/** Delete one note. Track names and trailing silence are retained, even when empty. */
export function deleteNote(song, index) {
  if (!Number.isInteger(index) || index < 0 || index >= song.notes.length) return song;
  return withNotes(song, song.notes.filter((_, i) => i !== index));
}
