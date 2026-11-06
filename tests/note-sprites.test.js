import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteShadowCache } from '../src/note-sprites.js';
import { PianoRenderer } from '../src/renderer.js';
import { DEFAULT_SETTINGS } from '../src/model.js';

function canvasFactory() {
  const canvases = [];
  const create = () => {
    const counts = { blurred: 0, images: 0 };
    const ctx = { counts, shadowBlur: 0 };
    for (const method of ['save', 'restore', 'beginPath', 'roundRect', 'rect', 'clip', 'moveTo', 'lineTo', 'fillText']) ctx[method] = () => {};
    ctx.fill = ctx.stroke = () => { if (ctx.shadowBlur > 0) counts.blurred++; };
    ctx.drawImage = () => counts.images++;
    ctx.createLinearGradient = () => ({ addColorStop() {} });
    const canvas = { width: 1440, height: 810, getContext: () => ctx, ownerDocument: { createElement: create } };
    canvases.push(canvas);
    return canvas;
  };
  return { create, canvases };
}

const params = {
  x: 20.4, width: 10, height: 50, radius: 3, blur: 4,
  shadow: 'rgba(83,232,239,0.95)', stops: [[0, 'rgba(83,232,239,0.38)'], [1, 'rgba(83,232,239,0.48)']],
  strokes: [{ color: 'rgba(83,232,239,0.3)', width: 2 }, { color: '#aaffff', width: 1 }],
};

test('moving notes reuse three blurred layers while preserving direct sharp strokes', () => {
  const { create, canvases } = canvasFactory();
  const renderer = new PianoRenderer(create());
  const settings = { ...DEFAULT_SETTINGS, noteStyle: 'solid' };
  renderer.layout(settings, 1440);
  const note = { midi: 60, track: 0, time: 1.8, duration: 0.4 };
  renderer.drawNotes([note], 0.5, 100, 670, 1, settings);
  assert.equal(renderer.ctx.counts.blurred, 0, 'display canvas draws cached shadows without shadowBlur');
  assert.equal(renderer.ctx.counts.images, 3);
  assert.equal(canvases[1].getContext().counts.blurred, 3, 'all original shadow passes enter the atlas');
  renderer.drawNotes([note], 0.6, 100, 670, 1, settings);
  assert.equal(canvases.length, 2, 'moving the note does not allocate another texture');
  assert.equal(renderer.ctx.counts.images, 6);
  assert.equal(canvases[1].getContext().counts.blurred, 3, 'reused atlas requires no additional blur passes');
});

test('clipped, active and growing live notes use direct shadows without cache churn', () => {
  const { create, canvases } = canvasFactory();
  const renderer = new PianoRenderer(create());
  renderer.layout(DEFAULT_SETTINGS, 1440);
  renderer.drawNotes([{ midi: 60, time: 6.5, duration: 1 }], 0.5, 100, 670, 1, DEFAULT_SETTINGS);
  for (const time of [1, 1.1, 1.2]) {
    renderer.drawNotes([{ midi: 60, time: time - 0.02, duration: time }], time, 50, 670, 1, DEFAULT_SETTINGS);
  }
  assert.equal(canvases.length, 1);
  assert.equal(renderer.ctx.counts.images, 0);
  assert.equal(renderer.ctx.counts.blurred, 12);
});

test('note material changes release old GPU atlases before rebuilding', () => {
  const { create, canvases } = canvasFactory();
  const renderer = new PianoRenderer(create());
  const settings = { ...DEFAULT_SETTINGS, noteStyle: 'solid' };
  renderer.layout(settings, 1440);
  const note = { midi: 60, time: 2, duration: 0.4 };
  renderer.drawNotes([note], 0.5, 100, 670, 1, settings);
  const original = canvases[1];
  settings.colorA = '#ff0000';
  renderer.drawNotes([note], 0.6, 100, 670, 1, settings);
  assert.equal(original.width, 1);
  assert.equal(original.height, 1);
  assert.equal(renderer.noteShadows.entries.size, 1);
  settings.glow = 0;
  renderer.drawNotes([note], 0.7, 100, 670, 1, settings);
  assert.equal(renderer.noteShadows.entries.size, 0);
  assert.equal(renderer.noteShadows.pixels, 0);
});

test('shadow atlas cache enforces its pixel budget, evicts and releases textures', () => {
  const { create } = canvasFactory();
  const cache = new NoteShadowCache((width, height) => {
    const canvas = create(); canvas.width = width; canvas.height = height;
    return { canvas, ctx: canvas.getContext() };
  }, 10000);
  const first = cache.get('first', params);
  assert.equal(cache.get('first', params), first);
  const second = cache.get('second', params);
  assert.notEqual(second, first);
  assert.equal(first.canvas.width, 1);
  assert.equal(first.canvas.height, 1);
  assert.equal(cache.entries.size, 1);
  assert.ok(cache.pixels <= cache.maxPixels);
  assert.equal(cache.get('oversized', { ...params, height: 500 }), null);
  assert.equal(cache.entries.size, 1, 'oversized entries fall back without evicting usable entries');
  cache.clear();
  assert.equal(second.canvas.width, 1);
  assert.equal(cache.pixels, 0);
});

test('renderer falls back to direct shadows when an atlas cannot be allocated', () => {
  const { create } = canvasFactory();
  const renderer = new PianoRenderer(create());
  renderer.createLayer = () => null;
  renderer.layout(DEFAULT_SETTINGS, 1440);
  renderer.drawNotes([{ midi: 60, time: 2, duration: 0.4 }], 0.5, 100, 670, 1, DEFAULT_SETTINGS);
  assert.equal(renderer.ctx.counts.blurred, 3);
  assert.equal(renderer.ctx.counts.images, 0);
});
