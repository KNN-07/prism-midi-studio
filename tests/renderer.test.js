import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteWindowIndex } from '../src/renderer.js';

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
