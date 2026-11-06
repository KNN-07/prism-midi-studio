import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, createDemoSong, encodeMidi } from '../src/midi.js';

const text = s => [...new TextEncoder().encode(s)];
const u32 = n => [n >>> 24 & 255,n >>> 16 & 255,n >>> 8 & 255,n & 255];
const vlq = n => { const out = [n & 127]; while ((n >>= 7)) out.unshift(n & 127 | 128); return out; };
const chunk = (tag, data) => [...text(tag),...u32(data.length),...data];
const midi = (tracks, division = 480, format = 1) => new Uint8Array([...chunk('MThd',[0,format,0,tracks.length,division >> 8,division & 255]),...tracks.flatMap(t => chunk('MTrk',t))]);
const end = [0,255,47,0];

test('tempo maps across tracks and changes within sustained notes', () => {
  const buffer = midi([[0,255,81,3,7,161,32,...vlq(480),255,81,3,15,66,64,...end], [0,144,60,100,...vlq(960),128,60,0,...end]]);
  const song = parseMidi(buffer, 'tempo.mid');
  assert.equal(song.name, 'tempo'); assert.equal(song.bpm,120); assert.equal(song.notes[0].duration,1.5); assert.equal(song.tempos[1].time,.5);
});

test('running status, note-on zero release, and pitches beyond piano range', () => {
  const song = parseMidi(midi([[0,144,12,90,...vlq(240),120,70,...vlq(240),12,0,...vlq(240),120,0,...end]],480,0));
  assert.equal(song.notes.length,2); assert.equal(song.notes[0].midi,12); assert.equal(song.notes[1].midi,120);
  assert.equal(song.notes[0].duration,.5); assert.equal(song.notes[1].time,.25); assert.equal(song.notes[1].duration,.5);
});

test('sustain pedal holds released notes until pedal up', () => {
  const song = parseMidi(midi([[0,176,64,127,0,144,60,100,...vlq(240),128,60,0,...vlq(720),176,64,0,...end]]));
  assert.equal(song.notes[0].duration,1);
  assert.equal(song.notes[0].keyDuration,.25);
});

test('overlapping repetitions pair note-offs in input order', () => {
  const song = parseMidi(midi([[0,144,60,100,...vlq(120),144,60,80,...vlq(120),128,60,0,...vlq(240),128,60,0,...end]]));
  assert.deepEqual(song.notes.map(n => [n.time,n.duration]), [[0,.25],[.125,.375]]);
});

test('all sound off ends sustained and active notes', () => {
  const song = parseMidi(midi([[0,176,64,127,0,144,60,100,...vlq(240),128,60,0,0,144,64,90,...vlq(240),176,120,0,...end]]));
  assert.equal(song.notes[0].duration,.5); assert.equal(song.notes[1].duration,.25);
});

test('rejects unsupported format, SMPTE timing, and malformed data', () => {
  assert.throws(() => parseMidi(new Uint8Array([1,2])), /truncated/);
  assert.throws(() => parseMidi(midi([end],480,2)), /Format 2/);
  assert.throws(() => parseMidi(midi([end],0xe728)), /SMPTE/);
  assert.throws(() => parseMidi(midi([[0,60,100,...end]])), /running status/);
  assert.throws(() => parseMidi(midi([[0x80,0x80,0x80,0x80,0x00,...end]])), /variable-length/);
  assert.throws(() => parseMidi(midi([[0,144,60,200,...end]])), /channel data/);
  assert.throws(() => parseMidi(midi([[0,255,81,3,0,0,0,...end]])), /zero tempo/);
  assert.throws(() => parseMidi(midi([end])), /no playable notes/);
});

test('original demo survives MIDI export/import with timing and tracks', () => {
  const original = createDemoSong(), recovered = parseMidi(encodeMidi(original),'First light.mid');
  assert.equal(recovered.notes.length,original.notes.length); assert.equal(recovered.bpm,96);
  assert.equal(recovered.duration,original.duration);
  for (let i = 0; i < original.notes.length; i++) {
    assert.equal(recovered.notes[i].midi,original.notes[i].midi);
    assert.ok(Math.abs(recovered.notes[i].time - original.notes[i].time) < .002);
    assert.ok(Math.abs(recovered.notes[i].duration - original.notes[i].duration) < .002);
  }
  assert.equal(recovered.tracks[1].name,'Arpeggio & bass'); assert.equal(recovered.tracks[2].name,'Melody');
});

test('MIDI export rejects nonfinite or unsafe ticks before variable-length encoding', () => {
  const song = { bpm: 120, duration: 1, notes: [{ midi: 60, time: 0, duration: 1, velocity: .75, track: 0, channel: 0 }] };
  for (const value of [NaN, Infinity, -Infinity, 1e308]) {
    assert.throws(() => encodeMidi({ ...song, notes: [{ ...song.notes[0], time: value }] }), /finite/);
    assert.throws(() => encodeMidi({ ...song, notes: [{ ...song.notes[0], duration: value }] }), /finite/);
    assert.throws(() => encodeMidi({ ...song, duration: value }), /finite/);
  }
  assert.throws(() => encodeMidi({ ...song, notes: [{ ...song.notes[0], time: 1e308, duration: 1e308 }] }), /finite/);
});

test('MIDI export bounds each delta to the four-byte Standard MIDI limit', () => {
  const maxSeconds = 0x0fffffff / 960;
  const song = { bpm: 120, duration: maxSeconds + 1, notes: [{ midi: 60, time: maxSeconds, duration: 1, velocity: .75, track: 0, channel: 0 }] };
  assert.equal(parseMidi(encodeMidi(song)).notes[0].time, maxSeconds);
  assert.throws(() => encodeMidi({ ...song, notes: [{ ...song.notes[0], time: maxSeconds + 1 / 960 }] }), /gap too long/);
  assert.throws(() => encodeMidi({ ...song, duration: maxSeconds + 2, notes: [{ ...song.notes[0], time: 0 }] }), /gap too long/);
});
