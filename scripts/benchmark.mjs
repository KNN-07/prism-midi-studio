import { performance } from 'node:perf_hooks';
import { encodeMidi, parseMidi } from '../src/midi.js';
import { getNoteIndex } from '../src/note-index.js';

const runs = 5;

function benchmark(label, operation) {
  operation(); // Warm up module code and JIT compilation before sampling.
  const samples = [];
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    operation();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(`${label}: ${samples[Math.floor(runs / 2)].toFixed(2)} ms`);
}

// An opening sustain must not force late playback to scan expired history.
const indexedNotes = Array.from({ length: 250_000 }, (_, i) => ({
  time: i * .01,
  duration: i === 0 ? 4000 : .005,
}));
getNoteIndex(indexedNotes); // Measure shared lookups after the one-time build.

const overlapping = {
  bpm: 120,
  duration: 4,
  notes: Array.from({ length: 75_000 }, (_, i) => ({
    midi: 60, time: 0, duration: 1 + i / 100_000,
    velocity: .7, track: 0, channel: 0,
  })),
};
const encodedOverlapping = encodeMidi(overlapping);

const multitrack = {
  bpm: 120,
  duration: 1000,
  notes: Array.from({ length: 100_000 }, (_, i) => ({
    midi: 36 + i % 72, time: i / 100, duration: .005,
    velocity: .7, track: i % 512, channel: i % 16,
  })),
};

console.log(`PRISM CPU benchmarks — median of ${runs} runs after warm-up`);
benchmark('Shared index: 10,000 late windows in 250,000 notes with a long sustain', () => {
  let matches = 0;
  const count = () => { matches++; };
  for (let i = 0; i < 10_000; i++) {
    const time = 2000 + (i % 4000) * .1;
    getNoteIndex(indexedNotes).forEach(time, time + .1, count);
  }
  if (matches < 100_000) throw new Error('Indexed query returned too few notes.');
});
benchmark('MIDI parse: 75,000 overlapping same-pitch notes', () => {
  const song = parseMidi(encodedOverlapping);
  if (song.notes.length !== overlapping.notes.length) throw new Error('Parsed note count changed.');
});
benchmark('MIDI export: 100,000 notes across 512 tracks', () => {
  const bytes = encodeMidi(multitrack);
  if (!bytes.byteLength) throw new Error('MIDI export was empty.');
});
