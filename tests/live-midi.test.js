import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveMidi } from '../src/live-midi.js';
import { PianoAudio } from '../src/audio.js';

function fixture(deferred = false) {
  let resume;
  const pending = deferred ? new Promise(resolve => { resume = resolve; }) : Promise.resolve();
  const calls = [], notes = new Map();
  const audio = { unlock: () => pending, noteOn: (...args) => calls.push(['on', ...args]), noteOff: (...args) => calls.push(['off', ...args]) };
  return { controller: new LiveMidi(audio, { getTime: () => 2.5 }, notes), calls, notes, resume };
}

test('releasing before audio resumes cannot create a late stuck voice', async () => {
  const { controller, calls, notes, resume } = fixture(true);
  const pending = controller.noteOn(60, .7);
  assert.equal(notes.size, 1);
  controller.noteOff(60); resume(); await pending;
  assert.equal(notes.size, 0); assert.deepEqual(calls, []);
});

test('reset cancels every pending attack and clears sustain state', async () => {
  const { controller, calls, notes, resume } = fixture(true);
  controller.sustain(0, 127);
  const pending = controller.noteOn(60); controller.noteOff(60); controller.reset(); resume(); await pending;
  assert.equal(notes.size, 0); assert.equal(controller.pedals.size, 0); assert.deepEqual(calls, []);
});

test('latest repeated attack wins while audio startup is pending', async () => {
  const { controller, calls, notes, resume } = fixture(true);
  const first = controller.noteOn(60,.4), second = controller.noteOn(60,.8);
  resume(); await Promise.all([first,second]);
  assert.deepEqual(calls, [['on',60,.8,0]]); assert.equal(notes.get('0:60').velocity,.8);
});

test('sustain holds notes until pedal-up independently for each channel', async () => {
  const { controller, calls, notes } = fixture();
  controller.controlChange(64,127,1);
  await controller.noteOn(60,.7,0); await controller.noteOn(60,.6,1);
  controller.noteOff(60,0); controller.noteOff(60,1);
  assert.equal(notes.size,1); assert.ok(notes.has('1:60'));
  controller.controlChange(64,0,1);
  assert.equal(notes.size,0);
  assert.deepEqual(calls,[['on',60,.7,0],['on',60,.6,1],['off',60,0],['off',60,1]]);
});

test('all sound off respects channel and reset controllers releases pedal', async () => {
  const { controller, notes } = fixture();
  controller.sustain(0,true); controller.sustain(1,true);
  await controller.noteOn(60,.7,0); await controller.noteOn(60,.6,1);
  controller.noteOff(60,0); controller.noteOff(60,1);
  controller.controlChange(120,0,1); assert.equal(notes.size,1); assert.ok(notes.has('0:60'));
  controller.controlChange(121,0,0); assert.equal(notes.size,0);
});

test('blocked live start never requests audio or creates notes', async () => {
  const notes = new Map();
  const controller = new LiveMidi({unlock:()=>assert.fail('Unexpected audio request')},{onStart:()=>false},notes);
  await controller.noteOn(60); assert.equal(notes.size,0);
});

test('audio scheduler uses lookahead without duplicate attacks and restores held notes on seek', () => {
  const audio = new PianoAudio(), scheduled = [];
  audio.context = {currentTime:0,state:'running'};
  audio._voice = (midi,velocity,time,duration) => scheduled.push({midi,time,duration});
  const song = {notes:[{midi:60,time:0,duration:1,velocity:.7},{midi:64,time:.1,duration:1,velocity:.7},{midi:67,time:.3,duration:1,velocity:.7}]};
  audio.tick(song,0,true); assert.equal(scheduled.length,2);
  audio.context.currentTime=.05; audio.tick(song,.05,true); assert.equal(scheduled.length,2);
  audio.context.currentTime=.2; audio.tick(song,.2,true); assert.equal(scheduled.length,3);
  audio.context.currentTime=.21; audio.tick(song,.8,true); assert.equal(scheduled.length,6);
  audio.tick(song,.8,false); assert.equal(audio.playing,false);
});

test('audio live voices use channel and pitch as their identity', () => {
  const audio = new PianoAudio(), released = [];
  audio.context = {currentTime:0,state:'running'};
  audio._voice = (midi,velocity) => ({midi,velocity});
  audio._release = voice => released.push(voice);
  audio.noteOn(60,.7,0); audio.noteOn(60,.6,1);
  assert.equal(audio.liveVoices.size,2);
  audio.noteOff(60,0); assert.equal(audio.liveVoices.size,1); assert.ok(audio.liveVoices.has('1:60'));
  assert.equal(released.length,1);
});
