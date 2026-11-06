import test from 'node:test';
import assert from 'node:assert/strict';
import { PianoRenderer } from '../src/renderer.js';
import { DEFAULT_SETTINGS } from '../src/model.js';

function instrumentedRenderer() {
  const contexts = [];
  const createCanvas = () => {
    const ctx = { fills: [], images: [], clears: [], gradients: 0 };
    ctx.fillRect = (...args) => ctx.fills.push(args);
    ctx.clearRect = (...args) => ctx.clears.push(args);
    ctx.drawImage = (...args) => ctx.images.push(args);
    ctx.createLinearGradient = ctx.createRadialGradient = () => { ctx.gradients++; return { addColorStop() {} }; };
    for (const name of ['save', 'restore', 'translate', 'beginPath', 'roundRect', 'rect', 'clip', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillText']) ctx[name] = () => {};
    contexts.push(ctx);
    return { width: 1440, height: 810, getContext(type, options) { ctx.options = options; return ctx; }, ownerDocument: { createElement: createCanvas } };
  };
  const renderer = new PianoRenderer(createCanvas());
  renderer.layout(DEFAULT_SETTINGS, 1440);
  return { renderer, contexts };
}

test('opaque cached backgrounds replace the clear and skip concealed keyboard pixels', () => {
  const { renderer, contexts } = instrumentedRenderer();
  for (const name of ['drawNotes', 'drawRadiance', 'drawRibbons', 'drawParticles', 'drawKeyboard', 'drawSaber']) renderer[name] = () => {};
  renderer.render({ time: 1, settings: DEFAULT_SETTINGS });
  renderer.render({ time: 2, settings: DEFAULT_SETTINGS });
  assert.equal(contexts[0].fills.length, 0, 'steady background needs no separate full-canvas fill');
  assert.equal(contexts[0].images.length, 2, 'one opaque background draw each frame');
  const layer = renderer.backgroundLayer;
  assert.equal(layer.ctx.options.alpha, false);
  assert.equal(layer.canvas.height, Math.ceil(810 * .83));
  const fills = layer.ctx.fills.length;
  renderer.render({ time: 3, settings: DEFAULT_SETTINGS });
  assert.equal(layer.ctx.fills.length, fills, 'cached background is not repainted');
  renderer.render({ time: 4, settings: { ...DEFAULT_SETTINGS, background: '#123456' } });
  assert.ok(layer.ctx.fills.length > fills, 'base color changes invalidate the opaque cache');
  renderer.render({ time: 5, settings: { ...DEFAULT_SETTINGS, keyboard: false } });
  assert.equal(renderer.backgroundLayer.canvas.height, 810, 'hiding keyboard restores the entire backdrop');
});

test('static media is cached with its dimming and replacement refreshes the image', () => {
  const { renderer, contexts } = instrumentedRenderer();
  const first = { naturalWidth: 1920, naturalHeight: 1080, src: 'first' };
  const draw = (background, settings = DEFAULT_SETTINGS) => renderer.drawBackground(background, settings, 1440, 810, 672.3, 1);
  draw(first); draw(first);
  const layer = renderer.backgroundLayer;
  assert.equal(layer.ctx.images.length, 1);
  assert.equal(layer.ctx.images[0][0], first);
  assert.equal(contexts[0].images.length, 2);
  assert.equal(layer.canvas.height, 673);
  const second = { ...first };
  draw(second);
  assert.equal(layer.ctx.images.length, 2, 'replacement media invalidates even at the same dimensions');
  draw(second, { ...DEFAULT_SETTINGS, backgroundDim: 90 });
  assert.equal(layer.ctx.images.length, 3, 'dimming is part of the cached composition');
  second.src = 'changed'; draw(second);
  assert.equal(layer.ctx.images.length, 4, 'same image element with a new source refreshes');
});

test('dynamic media is redrawn every frame and retains full-scene cover cropping', () => {
  const { renderer, contexts } = instrumentedRenderer();
  const video = { videoWidth: 1920, videoHeight: 1080 };
  const draw = () => renderer.drawBackground(video, DEFAULT_SETTINGS, 1440, 810, 672.3, 1);
  draw(); draw();
  assert.equal(contexts[0].images.length, 4, 'each frame draws current video and cached dim/overlay');
  assert.equal(contexts[0].fills.length, 2, 'one bounded base fill per video frame');
  const videoDraw = contexts[0].images[0];
  assert.equal(videoDraw[0], video);
  assert.deepEqual(videoDraw.slice(1), [0, 0, 1920, 673 / .75, 0, 0, 1440, 673]);
  assert.equal(renderer.backgroundLayer.ctx.options.alpha, true);
  const paints = renderer.backgroundLayer.ctx.fills.length;
  draw();
  assert.equal(renderer.backgroundLayer.ctx.fills.length, paints);
  renderer.drawBackground(null, DEFAULT_SETTINGS, 1440, 810, 672.3, 1);
  assert.equal(renderer.backgroundLayer.ctx.options.alpha, false);
});

test('held-note radiance reuses a bounded cache and refreshes when its appearance changes', () => {
  const { renderer, contexts } = instrumentedRenderer();
  const settings = { ...DEFAULT_SETTINGS, colorMode: 'track' };
  const active = new Map([[60, { track: 0 }], [64, { track: 1 }], [67, { track: 0 }]]);
  const draw = () => renderer.drawRadiance(active, 672.3, 810, 1, settings);
  draw(); draw();
  const layer = renderer.radianceLayer;
  assert.equal(contexts[0].gradients, 0, 'radiance gradients stay off the main render target');
  assert.equal(layer.ctx.gradients, 6, 'two gradients per key rasterized once');
  assert.equal(contexts[0].images.length, 2, 'one additive draw per frame');
  assert.ok(layer.canvas.height <= Math.ceil(810 * .3) + 1);
  assert.ok(contexts[0].images[0][3] < 1440 / 3, 'draw only the active horizontal region');
  active.set(60, { track: 2 }); draw();
  assert.equal(layer.ctx.gradients, 6, 'same track color reuses radiance');
  active.set(60, { track: 1 }); draw();
  assert.equal(layer.ctx.gradients, 12);
  settings.glow = 30; draw();
  assert.equal(layer.ctx.gradients, 18);
  active.delete(67); draw();
  assert.equal(layer.ctx.gradients, 22, 'releasing a key removes its cached light');
  active.clear(); const images = contexts[0].images.length; draw();
  assert.equal(contexts[0].images.length, images, 'no active keys means no radiance draw');
});
