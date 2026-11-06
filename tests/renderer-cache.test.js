import test from 'node:test';
import assert from 'node:assert/strict';
import { PianoRenderer } from '../src/renderer.js';
import { DEFAULT_SETTINGS } from '../src/model.js';

function instrumentedRenderer() {
  const contexts = [];
  const createCanvas = () => {
    const counts = { gradients: 0, images: 0 };
    const ctx = { counts };
    for (const method of ['fillRect', 'clearRect', 'save', 'restore', 'translate', 'beginPath', 'roundRect', 'rect', 'clip', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillText']) ctx[method] = () => {};
    ctx.drawImage = () => counts.images++;
    ctx.createLinearGradient = ctx.createRadialGradient = () => {
      counts.gradients++;
      return { addColorStop() {} };
    };
    contexts.push(ctx);
    return { width: 1440, height: 810, getContext: () => ctx, ownerDocument: { createElement: createCanvas } };
  };
  const renderer = new PianoRenderer(createCanvas());
  const paints = { background: 0, keyboard: 0 };
  for (const name of ['Background', 'Keyboard']) {
    const original = renderer[`paint${name}`];
    renderer[`paint${name}`] = function (...args) { paints[name.toLowerCase()]++; return original.apply(this, args); };
  }
  return { renderer, contexts, paints };
}

test('static layers reuse rasterization and invalidate for visual changes', () => {
  const { renderer, paints } = instrumentedRenderer();
  const settings = { ...DEFAULT_SETTINGS, trails: false, particles: false, saber: false };
  const song = { notes: [] };
  const frame = (extra = {}) => renderer.render({ song, settings, time: 0, ...extra });
  frame(); frame({ time: 0.1 }); frame({ time: 0.2 });
  assert.deepEqual(paints, { background: 1, keyboard: 1 });
  settings.labels = true;
  frame();
  assert.deepEqual(paints, { background: 1, keyboard: 2 });
  settings.colorA = '#ff0000';
  frame();
  assert.deepEqual(paints, { background: 2, keyboard: 3 });
  settings.minNote = 36;
  frame();
  assert.deepEqual(paints, { background: 3, keyboard: 4 });
  renderer.resize(1920, 1080);
  frame();
  assert.deepEqual(paints, { background: 4, keyboard: 5 });
  settings.keyboardHeight = 25;
  frame();
  assert.deepEqual(paints, { background: 5, keyboard: 6 });
});

test('keyboard cache follows note presses, release, and track colors', () => {
  const { renderer, paints } = instrumentedRenderer();
  const settings = { ...DEFAULT_SETTINGS, colorMode: 'track', particles: false, trails: false, saber: false };
  const note = { midi: 61, time: 0, duration: 1, track: 0 };
  const frame = (time, notes) => renderer.render({ song: { notes }, time, settings });
  frame(0, []);
  frame(0, [note]);
  frame(0.5, [note]);
  assert.equal(paints.keyboard, 2);
  frame(0.5, [{ ...note, track: 1 }]);
  assert.equal(paints.keyboard, 3);
  frame(0.5, [{ ...note, track: 3 }]);
  assert.equal(paints.keyboard, 3, 'tracks with the same color reuse the keyboard');
  frame(1, [note]);
  assert.equal(paints.keyboard, 4);
  assert.equal(paints.background, 1);
});

test('video frames remain live while their overlay is cached', () => {
  const { renderer, contexts, paints } = instrumentedRenderer();
  const settings = { ...DEFAULT_SETTINGS, keyboard: false, trails: false, particles: false, saber: false };
  const background = { videoWidth: 1920, videoHeight: 1080 };
  renderer.render({ time: 0, settings, background });
  renderer.render({ time: 0.1, settings, background });
  assert.equal(contexts[0].counts.images, 4, 'each frame draws both video and cached overlay');
  assert.equal(paints.background, 1);
  renderer.render({ time: 0.2, settings, background: null });
  assert.equal(paints.background, 2, 'removing media restores stars and aura');
});

test('note gradients survive movement and refresh when style or geometry changes', () => {
  const { renderer, contexts } = instrumentedRenderer();
  const settings = { ...DEFAULT_SETTINGS, noteStyle: 'solid' };
  renderer.layout(settings, 1440);
  const notes = [{ midi: 60, track: 0, time: 1, duration: 0.4 }];
  const draw = () => renderer.drawNotes(notes, 0.5, 100, 670, 1, settings);
  draw(); draw();
  assert.equal(contexts[0].counts.gradients, 1);
  settings.noteStyle = 'outline'; draw();
  assert.equal(contexts[0].counts.gradients, 2);
  settings.colorB = '#ff0000'; draw();
  assert.equal(contexts[0].counts.gradients, 3);
  renderer.layout(settings, 1920); draw();
  assert.equal(contexts[0].counts.gradients, 4);
});

test('cached particle parameters preserve deterministic seed values and stay bounded', () => {
  const { renderer } = instrumentedRenderer();
  const hash = value => { const n = Math.sin(value * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
  const note = { midi: 67, time: 12.345 };
  const values = renderer.particleParameters(note, 295);
  for (let i = 0; i < 295; i++) {
    const n = note.midi * 31 + note.time * 17 + i * 2.37;
    const life = 0.7 + hash(n + 6) * 1.25;
    assert.deepEqual([...values.slice(i * 7, i * 7 + 7)], [life, hash(n) * life, hash(n + 2) - 0.5, hash(n + 3) - 0.5, 0.55 + hash(n + 4) * 0.45, 0.4 + hash(n + 5) * 0.6, 0.8 + hash(n + 7) * 1.7]);
  }
  assert.equal(renderer.particleParameters(note, 50), values);
  note.time += 1;
  assert.notEqual(renderer.particleParameters(note, 295), values, 'mutated live note onset refreshes its seed');
  for (let i = 0; i < 1000; i++) renderer.particleParameters({ midi: 60, time: i }, 295);
  assert.ok(renderer.particleSeeds.size <= 72);
});

test('palette cache is bounded by pitch and track parity, not song track count', () => {
  const { renderer } = instrumentedRenderer();
  const settings = { ...DEFAULT_SETTINGS, colorMode: 'track' };
  for (let track = 0; track < 10000; track++) {
    assert.deepEqual(renderer.noteColor(60, track, settings), track % 2 ? [183, 154, 255] : [83, 232, 239]);
  }
  assert.equal(renderer.colors.size, 2);
  settings.colorA = '#010203';
  assert.deepEqual(renderer.noteColor(60, 0, settings), [1, 2, 3]);
});
