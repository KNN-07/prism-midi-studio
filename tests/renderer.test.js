import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteWindowIndex, PianoRenderer } from '../src/renderer.js';
import { getNoteIndex } from '../src/note-index.js';
import { DEFAULT_SETTINGS } from '../src/model.js';

function query(index, from, to) {
  const notes = [];
  index.forEach(from, to, note => notes.push(note));
  return notes;
}

test('visualization window preserves early sustained notes and inclusive boundaries', () => {
  const notes = [
    { time: 0, duration: 100, midi: 36 },
    { time: 1, duration: 0.1, midi: 60 },
    { time: 10, duration: 2, midi: 64 },
    { time: 12, duration: 0.5, midi: 67 },
    { time: 13, duration: 1, midi: 72 },
  ];
  const index = new NoteWindowIndex(notes);
  assert.deepEqual(query(index, 12, 12), [notes[0], notes[2], notes[3]]);
  assert.deepEqual(query(index, 12.1, 12.9), [notes[0], notes[3]]);
  assert.deepEqual(query(index, -4, -1), []);
  assert.deepEqual(query(index, 101, 105), []);
});

test('visualization index matches an interval scan across arbitrary seek positions', () => {
  const notes = Array.from({ length: 800 }, (_, i) => ({ time: i * 0.03, duration: i % 29 === 0 ? 20 : (i % 13) * 0.08 + 0.02, midi: 30 + i % 60 }));
  const index = new NoteWindowIndex(notes);
  for (let t = -1; t < 45; t += 0.73) {
    assert.deepEqual(query(index, t - 2, t + 3.8), notes.filter(n => n.time <= t + 3.8 && n.time + n.duration >= t - 2));
  }
  assert.deepEqual(query(new NoteWindowIndex([]), 0, 1), []);
});

test('late playback prunes expired history even with an opening note still held', () => {
  const notes = Array.from({ length: 250_000 }, (_, i) => ({ time: i * 0.01, duration: i === 0 ? 4000 : 0.005, midi: 60 }));
  const index = new NoteWindowIndex(notes);
  let inspectedNodes = 0;
  index.maxEnd = new Proxy(index.maxEnd, {
    get(target, property) {
      if (typeof property === 'string' && /^\d+$/.test(property)) inspectedNodes++;
      return target[property];
    },
  });
  const result = query(index, 2400, 2400.1);
  assert.equal(result[0], notes[0], 'long opening sustain remains visible');
  assert.ok(result.length >= 10 && result.length <= 12);
  assert.ok(inspectedNodes < 150, `expected bounded tree traversal, inspected ${inspectedNodes} nodes`);
});

test('shared note indexes invalidate when the note collection changes', () => {
  const notes = [{ time: 1, duration: 2 }, { time: 1, duration: 1 }, { time: 4, duration: 1 }];
  const original = getNoteIndex(notes);
  assert.equal(getNoteIndex(notes), original);
  assert.equal(original.lowerBound(0), 0);
  assert.equal(original.lowerBound(1), 0);
  assert.equal(original.lowerBound(1.001), 2);
  assert.equal(original.lowerBound(5), 3);
  assert.notEqual(getNoteIndex([...notes]), original);
  notes.push({ time: 6, duration: 1 });
  const appended = getNoteIndex(notes);
  assert.notEqual(appended, original);
  assert.deepEqual(query(appended, 6, 7), [notes[3]]);
  notes.length = 1;
  assert.deepEqual(query(getNoteIndex(notes), 0, 7), notes);
});

function collectionRenderer() {
  const noop = () => {};
  const ctx = { fillRect: noop, save: noop, restore: noop, beginPath: noop, rect: noop, clip: noop };
  const renderer = new PianoRenderer({ width: 1440, height: 810, getContext: () => ctx });
  for (const method of ['drawBackground', 'drawNotes', 'drawRadiance', 'drawRibbons', 'drawParticles', 'drawKeyboard', 'drawSaber']) renderer[method] = noop;
  return renderer;
}

test('dense render windows preserve note layering and effect source order across seeks', () => {
  const notes = Array.from({ length: 2000 }, (_, i) => ({
    time: i * 0.015, duration: i % 37 === 0 ? 40 : 0.4, midi: 15 + i % 105, track: i % 2,
  }));
  const song = { notes };
  const renderer = collectionRenderer();
  const settings = { ...DEFAULT_SETTINGS };
  for (const time of [12, 4, 0, 29, 8, 50]) {
    renderer.render({ song, time, settings });
    const inRange = note => note.midi >= settings.minNote && note.midi <= settings.maxNote;
    const visible = notes.filter(note => inRange(note) && note.time <= time + settings.fallTime && note.time + note.duration >= time);
    const reactive = notes.filter(note => inRange(note) && note.time <= time && note.time + note.duration > time - 2);
    const active = new Map(notes.filter(note => inRange(note) && note.time <= time && note.time + note.duration > time).map(note => [note.midi, note]));
    assert.deepEqual(renderer.visibleNotes, visible);
    assert.deepEqual(renderer.reactiveNotes, reactive.slice(-36));
    assert.deepEqual(renderer.activeNotes, active);
  }
  renderer.render({ song, time: 12, settings: { ...settings, trails: false, particles: false } });
  assert.deepEqual(renderer.reactiveNotes, []);
  assert.equal(renderer.noteIndex, getNoteIndex(notes));
});

test('live columns keep growing while live effects remain after song sources', () => {
  const notes = Array.from({ length: 80 }, (_, i) => ({ time: i * 0.01, duration: 3, midi: 60, track: 0 }));
  const live = { time: 0.8, duration: 36000, midi: 60, track: 1, velocity: 0.7 };
  const renderer = collectionRenderer();
  for (const time of [1, 1.5, 4]) {
    renderer.render({ song: { notes }, time, settings: DEFAULT_SETTINGS, liveNotes: [live] });
    const column = renderer.visibleNotes.at(-1);
    assert.equal(column.time, time - 0.02);
    assert.equal(column.duration, Math.min(2.5, time - live.time));
    assert.equal(renderer.activeNotes.get(60), live);
    const expected = [...notes.filter(note => note.time + note.duration > time - 2), live].slice(-36);
    assert.deepEqual(renderer.reactiveNotes, expected);
  }
  renderer.render({ song: { notes: [] }, time: 5, settings: DEFAULT_SETTINGS });
  assert.deepEqual(renderer.visibleNotes, []);
  assert.deepEqual(renderer.reactiveNotes, []);
  assert.equal(renderer.activeNotes.size, 0);
});


test('pedal extension toggle switches bars and active keys without changing audio duration', () => {
  const renderer = collectionRenderer();
  const note = { midi: 60, time: 0, duration: 4, keyDuration: .25, velocity: .8, track: 0 };
  const song = { notes: [note] };
  renderer.render({ song, time: 1, settings: { ...DEFAULT_SETTINGS } });
  assert.equal(renderer.visibleNotes.length, 0);
  assert.equal(renderer.activeNotes.size, 0);
  renderer.render({ song, time: 1, settings: { ...DEFAULT_SETTINGS, extendPedalNotes: true } });
  assert.deepEqual(renderer.visibleNotes, [note]);
  assert.equal(renderer.activeNotes.get(60), note);
  renderer.render({ song, time: 1, settings: { ...DEFAULT_SETTINGS } });
  assert.equal(renderer.visibleNotes.length, 0);
  assert.equal(note.duration, 4);
});

test('rising windows preserve played notes, active keys and effects across arbitrary seeks', () => {
  const notes = Array.from({ length: 2000 }, (_, i) => ({
    time: i * 0.015, duration: i % 37 === 0 ? 40 : 0.4, keyDuration: i % 37 === 0 ? 35 : 0.2,
    midi: 15 + i % 105, track: i % 2,
  }));
  const renderer = collectionRenderer();
  for (const fallTime of [1, 3.8, 8]) for (const effects of [true, false]) for (const extendPedalNotes of [true, false]) {
    const settings = { ...DEFAULT_SETTINGS, noteDirection: 'up', fallTime, extendPedalNotes, trails: effects, particles: effects };
    for (const time of [12, 4, 0, 29, 8, 50]) {
      renderer.render({ song: { notes }, time, settings });
      const played = notes.filter(note => note.midi >= settings.minNote && note.midi <= settings.maxNote && note.time <= time);
      const end = note => note.time + (extendPedalNotes ? note.duration : note.keyDuration);
      assert.deepEqual(renderer.visibleNotes, played.filter(note => end(note) >= time - fallTime));
      assert.deepEqual(renderer.reactiveNotes, effects ? played.filter(note => end(note) > time - 2).slice(-36) : []);
      assert.deepEqual(renderer.activeNotes, new Map(played.filter(note => end(note) > time).map(note => [note.midi, note])));
    }
  }
});

function noteShapeRenderer() {
  const renderer = collectionRenderer();
  renderer.canvas.height = 1000;
  const shapes = [];
  renderer.ctx.roundRect = (x, y, width, height) => shapes.push({ y, height });
  renderer.ctx.fill = renderer.ctx.stroke = () => {};
  renderer.ctx.createLinearGradient = () => ({ addColorStop() {} });
  renderer.drawNotes = PianoRenderer.prototype.drawNotes;
  return { renderer, shapes };
}

test('rising bars grow from the keyboard, detach at release and travel upward', () => {
  const { renderer, shapes } = noteShapeRenderer();
  const note = { midi: 60, time: 1, duration: 2, velocity: 0.8 };
  const settings = { ...DEFAULT_SETTINGS, noteDirection: 'up', fallTime: 4, keyboardHeight: 20, noteStyle: 'solid', glow: 0 };
  const frame = time => { shapes.length = 0; renderer.render({ song: { notes: [note] }, time, settings }); return shapes; };
  assert.deepEqual(frame(0), [], 'future notes stay hidden');
  assert.deepEqual(frame(1), [], 'the bar starts at the strike line');
  assert.equal(renderer.activeNotes.get(60), note, 'key highlights at note-on');
  assert.deepEqual(frame(1.5), [{ y: 700, height: 100 }]);
  assert.deepEqual(frame(2), [{ y: 600, height: 200 }]);
  assert.deepEqual(frame(3), [{ y: 400, height: 400 }]);
  assert.equal(renderer.activeNotes.size, 0, 'key releases while the bar remains visible');
  assert.deepEqual(frame(3.5), [{ y: 300, height: 400 }]);
  assert.deepEqual(frame(7.1), [], 'released bars expire after crossing the visible area');
  assert.deepEqual(frame(1.5), [{ y: 700, height: 100 }], 'seeking back reconstructs the same bar');
  settings.noteDirection = 'down';
  assert.deepEqual(frame(0), [{ y: 200, height: 400 }], 'switching back restores falling future notes');
});

test('rising pedal extension changes release position without altering note timing', () => {
  const { renderer, shapes } = noteShapeRenderer();
  const note = { midi: 60, time: 1, duration: 2, keyDuration: 0.5, velocity: 0.8 };
  const settings = { ...DEFAULT_SETTINGS, noteDirection: 'up', fallTime: 4, keyboardHeight: 20, noteStyle: 'solid', glow: 0 };
  renderer.render({ song: { notes: [note] }, time: 2, settings });
  assert.deepEqual(shapes, [{ y: 600, height: 100 }]);
  assert.equal(renderer.activeNotes.size, 0);
  shapes.length = 0;
  renderer.render({ song: { notes: [note] }, time: 2, settings: { ...settings, extendPedalNotes: true } });
  assert.deepEqual(shapes, [{ y: 600, height: 200 }]);
  assert.equal(renderer.activeNotes.get(60), note);
  assert.equal(note.time, 1);
  assert.equal(note.duration, 2);
  assert.equal(note.keyDuration, 0.5);
});

test('file direction leaves live keyboard column geometry unchanged', () => {
  const { renderer, shapes } = noteShapeRenderer();
  const live = { midi: 60, time: 1, duration: 36000, velocity: 0.8 };
  const settings = { ...DEFAULT_SETTINGS, fallTime: 4, keyboardHeight: 20, noteStyle: 'solid', glow: 0 };
  for (const time of [1.5, 2, 4]) {
    shapes.length = 0;
    renderer.render({ time, settings, liveNotes: [live] });
    const down = [...shapes];
    shapes.length = 0;
    renderer.render({ time, settings: { ...settings, noteDirection: 'up' }, liveNotes: [live] });
    assert.deepEqual(shapes, down);
    assert.equal(renderer.activeNotes.get(60), live);
  }
});

test('rising shadow cache waits for release and distinguishes short falling bars', () => {
  const { renderer } = noteShapeRenderer();
  const settings = { ...DEFAULT_SETTINGS, noteDirection: 'up', noteStyle: 'solid' };
  const note = { midi: 60, time: 1, duration: 0.02 };
  const shadows = [];
  renderer.noteShadows.get = (key, params) => { shadows.push({ key, height: params.height }); return null; };
  renderer.layout(settings, 1440);
  renderer.drawNotes([note], 1.01, 100, 800, 1, settings);
  assert.deepEqual(shadows, [], 'growing bars do not allocate changing shadow textures');
  renderer.drawNotes([note], 1.1, 100, 800, 1, settings);
  renderer.drawNotes([note], 1.2, 100, 800, 1, settings);
  assert.equal(shadows.length, 2);
  assert.equal(shadows[0].key, shadows[1].key, 'released bars reuse the same shadow');
  assert.equal(shadows[0].height, 2);
  renderer.drawNotes([note], 0.5, 100, 800, 1, { ...settings, noteDirection: 'down' });
  assert.equal(shadows[2].height, 7);
  assert.notEqual(shadows[0].key, shadows[2].key, 'falling minimum height cannot reuse a shorter rising shadow');
});
