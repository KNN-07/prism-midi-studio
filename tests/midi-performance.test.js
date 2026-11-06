import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMidi, parseMidi } from '../src/midi.js';

function singleTrack(body) {
  const bytes = new Uint8Array(body.length + 22);
  bytes.set([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107]);
  new DataView(bytes.buffer).setUint32(18, body.length);
  bytes.set(body, 22);
  return bytes;
}

test('dense overlapping repetitions retain FIFO pairing and velocity', () => {
  const count = 30_000, body = [];
  for (let i = 0; i < count; i++) body.push(0,144,60,1 + i % 127);
  for (let i = 0; i < count; i++) body.push(1,128,60,0);
  body.push(0,255,47,0);
  const song = parseMidi(singleTrack(body));
  assert.equal(song.notes.length, count);
  for (let i = 0; i < count; i++) {
    assert.equal(song.notes[i].velocity, (1 + i % 127) / 127);
    assert.ok(Math.abs(song.notes[i].duration - (i + 1) / 960) < 1e-12);
  }
});

test('tempo cursor preserves dangling notes and pedal releases across tempo changes', () => {
  const song = parseMidi(singleTrack([
    0,144,60,100,
    0,176,64,127,
    120,144,64,80,
    120,128,64,0,
    0,255,81,3,15,66,64,
    120,176,64,0,
    0,144,67,70,
    0,255,47,0,
  ]));
  assert.deepEqual(song.notes.map(n => [n.midi, n.time, n.duration]), [
    [60, 0, .5], [64, .125, .375], [67, .5, .25],
  ]);
  assert.equal(song.duration, .75);
});

test('many sparse tracks export with original names, channels, and timings', () => {
  const notes = Array.from({ length: 2560 }, (_, i) => ({
    midi: 36 + i % 72, time: i / 16, duration: .03125,
    velocity: (40 + i % 80) / 127, track: (i % 128) * 2, channel: i % 16,
  }));
  const tracks = Array.from({ length: 255 }, (_, i) => ({ name: `Part ${i}` }));
  const recovered = parseMidi(encodeMidi({ bpm: 120, notes, tracks, duration: 160 }));
  assert.equal(recovered.tracks.length, 129);
  assert.equal(recovered.duration, 160);
  assert.equal(recovered.notes.length, notes.length);
  for (let i = 0; i < notes.length; i++) {
    const actual = recovered.notes[i], expected = notes[i];
    assert.equal(actual.midi, expected.midi);
    assert.equal(actual.channel, expected.channel);
    assert.equal(actual.velocity, expected.velocity);
    assert.equal(actual.time, expected.time);
    assert.equal(actual.duration, expected.duration);
    assert.equal(recovered.tracks[actual.track].name, tracks[expected.track].name);
  }
});
