import test from 'node:test';
import assert from 'node:assert/strict';
import { addNote, deleteNote, editNote, MAX_EDIT_TIME, noteName, snapTime } from '../src/midi-edit.js';
import { encodeMidi, parseMidi } from '../src/midi.js';
import { getNoteIndex } from '../src/note-index.js';

function fixture() {
  return {
    name: 'Edit me', bpm: 120, duration: 6,
    tempos: [{ time: 0, tick: 0, bpm: 120 }],
    tracks: [{ name: 'Piano', count: 2 }, { name: 'Melody', count: 1 }],
    notes: [
      { midi: 60, time: 0, duration: 2, keyDuration: .5, velocity: .6, track: 0, channel: 0 },
      { midi: 67, time: 1, duration: .5, velocity: .8, track: 1, channel: 1 },
      { midi: 64, time: 2, duration: .75, velocity: .7, track: 0, channel: 0 },
    ],
  };
}

test('moving notes preserves the original snapshot and refreshes the cached time index', () => {
  const song = fixture(), before = structuredClone(song), oldIndex = getNoteIndex(song.notes);
  const edited = editNote(song, 0, { time: 4, midi: 72 });
  assert.deepEqual(song, before);
  assert.notEqual(edited, song);
  assert.notEqual(edited.notes, song.notes);
  assert.equal(edited.tempos, song.tempos);
  assert.deepEqual(edited.notes.map(note => note.time), [1, 2, 4]);
  assert.equal(edited.notes[2].keyDuration, .5);
  assert.notEqual(getNoteIndex(edited.notes), oldIndex);
  const hits = [];
  getNoteIndex(edited.notes).forEach(4.5, 4.6, note => hits.push(note.midi));
  assert.deepEqual(hits, [72]);
  const oldHits = [];
  oldIndex.forEach(4.5, 4.6, note => oldHits.push(note));
  assert.deepEqual(oldHits, []);
});

test('resizing sets key release and extends the performance without trimming original silence', () => {
  const song = fixture();
  const extended = editNote(song, 0, { duration: 8 });
  assert.equal(extended.duration, 8);
  assert.equal(extended.notes[0].keyDuration, 8);
  const shortened = editNote(song, 0, { duration: .25 });
  assert.equal(shortened.duration, 6);
  assert.equal(shortened.notes[0].keyDuration, .25);
  assert.equal(song.notes[0].keyDuration, .5);
});

test('velocity-only edits preserve imported notes shorter than the drawing minimum', () => {
  const song = fixture();
  song.notes[0] = { ...song.notes[0], duration: .001, keyDuration: .001 };
  const edited = editNote(song, 0, { velocity: .9 });
  assert.equal(edited.notes[0].duration, .001);
  assert.equal(edited.notes[0].keyDuration, .001);
  assert.equal(edited.notes[0].velocity, .9);
  assert.equal(editNote(song, 0, { midi: 61 }).notes[0].duration, .001);
  const moved = editNote(song, 0, { time: .1 });
  assert.equal(moved.notes[0].duration, .001);
});

test('adding, transferring and deleting refresh track counts while retaining track names', () => {
  const song = fixture();
  const added = addNote(song, { midi: 65, time: 1, duration: .2, track: 1, channel: 1 });
  assert.deepEqual(added.notes.map(note => note.midi), [60, 65, 67, 64]);
  assert.deepEqual(added.tracks.map(track => track.count), [2, 2]);
  const moved = editNote(added, 1, { track: 2, channel: 2 });
  assert.deepEqual(moved.tracks.map(track => [track.name, track.count]), [['Piano', 2], ['Melody', 1], ['Track 3', 1]]);
  const deleted = deleteNote(moved, 1);
  assert.deepEqual(deleted.tracks.map(track => track.count), [2, 1, 0]);
  assert.deepEqual(song.tracks.map(track => track.count), [2, 1]);
});

test('note values stay inside MIDI and playback bounds', () => {
  const song = fixture();
  const edited = editNote(song, 0, { midi: 160, time: -2, duration: -1, velocity: 0, channel: 30 });
  assert.deepEqual(edited.notes[0], { midi: 127, time: 0, duration: .001, keyDuration: .001, velocity: 1 / 127, track: 0, channel: 15 });
  assert.equal(editNote(song, 0, { duration: .005 }).notes[0].duration, .005);
  const low = editNote(song, 0, { midi: -20, velocity: 20 });
  assert.equal(low.notes[0].midi, 0);
  assert.equal(low.notes[0].velocity, 1);
  assert.equal(noteName(0), 'C-1');
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(61), 'C♯4');
  assert.equal(noteName(127), 'G9');
});

test('invalid edits and indices do not pollute playable data or history', () => {
  const song = fixture();
  for (const value of [NaN, Infinity, -Infinity, '60', null, undefined]) {
    assert.equal(editNote(song, 0, { time: value }), song);
    assert.equal(addNote(song, { midi: value }), song);
  }
  for (const index of [-1, 3, .5, NaN]) {
    assert.equal(editNote(song, index, { midi: 61 }), song);
    assert.equal(deleteNote(song, index), song);
  }
  assert.equal(editNote(song, 0, null), song);
  assert.equal(addNote(song, null), song);
});

test('editing enforces the 24-hour end boundary and rejects huge finite times', () => {
  const song = fixture();
  const boundary = editNote(song, 0, { time: MAX_EDIT_TIME - 1, duration: 1 });
  assert.equal(boundary.duration, MAX_EDIT_TIME);
  assert.equal(addNote(song, { time: 0, duration: MAX_EDIT_TIME }).duration, MAX_EDIT_TIME);
  for (const patch of [
    { time: MAX_EDIT_TIME }, { duration: MAX_EDIT_TIME + 1 },
    { time: MAX_EDIT_TIME - 1, duration: 2 },
    { time: 1e308 }, { duration: 1e308 }, { time: 1e308, duration: 1e308 },
  ]) {
    assert.equal(editNote(song, 0, patch), song);
    assert.equal(addNote(song, patch), song);
  }
  const long = { ...song, duration: MAX_EDIT_TIME * 2, notes: [{ ...song.notes[0], time: MAX_EDIT_TIME + 1 }] };
  assert.equal(editNote(long, 0, { midi: 65 }).notes[0].time, MAX_EDIT_TIME + 1);
  assert.equal(editNote(long, 0, { duration: 1 }), long);
  assert.equal(parseMidi(encodeMidi({ ...boundary, bpm: 300 })).duration, MAX_EDIT_TIME);
});

test('empty songs retain a usable timeline and can receive a first note', () => {
  const song = { ...fixture(), notes: [], tracks: [], duration: 0 };
  const added = addNote(song);
  assert.equal(added.duration, 1);
  assert.equal(added.notes[0].channel, 0);
  assert.deepEqual(added.tracks, [{ name: 'Track 1', count: 1 }]);
  const empty = deleteNote(added, 0);
  assert.equal(empty.duration, 1);
  assert.deepEqual(empty.notes, []);
  assert.deepEqual(empty.tracks, [{ name: 'Track 1', count: 0 }]);
  assert.equal(addNote(empty, { track: 2 }).notes[0].channel, 2);
});

test('beat snapping and free timing respect zero and avoid floating point display noise', () => {
  assert.equal(snapTime(.31, .125), .25);
  assert.equal(snapTime(.32, .125), .375);
  assert.equal(snapTime(.3, .1), .3);
  assert.equal(snapTime(.319, 0), .319);
  assert.equal(snapTime(-1, .125), 0);
  assert.equal(snapTime(Infinity, .125), 0);
});

test('edited notes survive MIDI export and import with timing, velocity and track names', () => {
  let song = editNote(fixture(), 0, { midi: 62, duration: 1.25, velocity: 95 / 127 });
  song = deleteNote(song, 2);
  song = addNote(song, { midi: 72, time: 3.25, duration: .75, velocity: 80 / 127, track: 1, channel: 1 });
  const restored = parseMidi(encodeMidi(song), 'edited.mid');
  assert.equal(restored.notes.length, song.notes.length);
  assert.equal(restored.duration, song.duration);
  for (let i = 0; i < song.notes.length; i++) {
    const actual = restored.notes[i], expected = song.notes[i];
    assert.equal(actual.midi, expected.midi);
    assert.ok(Math.abs(actual.time - expected.time) < .002);
    assert.ok(Math.abs(actual.duration - expected.duration) < .002);
    assert.ok(Math.abs(actual.velocity - expected.velocity) <= 1 / 127);
    assert.equal(restored.tracks[actual.track].name, song.tracks[expected.track].name);
  }
});
