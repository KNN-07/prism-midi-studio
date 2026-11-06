import test from 'node:test';
import assert from 'node:assert/strict';
import { PianoAudio } from '../src/audio.js';
import { getNoteIndex } from '../src/note-index.js';

function scheduler() {
  const audio = new PianoAudio(), scheduled = [];
  audio.context = { state: 'running', currentTime: 0 };
  audio._voice = (midi, velocity, when, duration) => scheduled.push({ midi, velocity, when, duration });
  return { audio, scheduled };
}

test('seeking restores held notes and schedules nearby attacks once', () => {
  const { audio, scheduled } = scheduler();
  const song = { notes: [
    { time: 0, duration: 20, midi: 36, velocity: .8 },
    { time: 1, duration: 1, midi: 40, velocity: .7 },
    { time: 9, duration: 1.025, midi: 44, velocity: .7 },
    { time: 9.999, duration: .5, midi: 48, velocity: .7 },
    { time: 10.1, duration: .5, midi: 52, velocity: .7 },
    { time: 10.16, duration: .5, midi: 56, velocity: .7 },
  ] };
  audio.tick(song, 10, true);
  assert.deepEqual(scheduled.map(n => n.midi), [36, 48, 52]);
  assert.equal(scheduled[0].duration, 10);
  assert.equal(scheduled[0].velocity, .8 * Math.exp(-3));
  assert.equal(scheduled[1].when, 0);
  assert.ok(Math.abs(scheduled[2].when - .1) < 1e-12);
  audio.context.currentTime = .05;
  audio.tick(song, 10.05, true);
  assert.deepEqual(scheduled.map(n => n.midi), [36, 48, 52, 56]);
});

test('speed changes restore held durations using the new speed', () => {
  const { audio, scheduled } = scheduler();
  const song = { notes: [{ time: 0, duration: 20, midi: 36, velocity: .8 }] };
  audio.tick(song, 10, true);
  audio.tick(song, 10, true, 2);
  assert.deepEqual(scheduled.map(n => n.duration), [10, 5]);
  audio.tick(song, 10, false, 2);
  assert.equal(audio.playing, false);
});

test('late seeks avoid reading expired history after the shared index is built', () => {
  const { audio, scheduled } = scheduler();
  let timeReads = 0;
  const notes = Array.from({ length: 100_000 }, (_, i) => ({
    get time() { timeReads++; return i * .01; },
    duration: i === 0 ? 2000 : .005,
    midi: 36 + i % 60,
    velocity: .7,
  }));
  getNoteIndex(notes);
  timeReads = 0;
  audio.tick({ notes }, 950, true);
  assert.equal(scheduled[0].midi, 36);
  assert.equal(scheduled[0].duration, 1050);
  assert.ok(timeReads < 300, `expected bounded seek work, read ${timeReads} note times`);
});
