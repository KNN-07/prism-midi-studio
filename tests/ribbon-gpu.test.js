import test from 'node:test';
import assert from 'node:assert/strict';
import { PianoRenderer } from '../src/renderer.js';
import { DEFAULT_SETTINGS } from '../src/model.js';

function fixture(filter = true) {
  const contexts = [];
  function canvas() {
    const c = { shadowBlur: 0, strokes: 0, blurredStrokes: 0, images: 0, filteredImages: 0 };
    if (filter) c.filter = 'none';
    for (const method of ['clearRect', 'save', 'restore', 'scale', 'translate', 'beginPath', 'moveTo', 'lineTo']) c[method] = () => {};
    c.createLinearGradient = () => ({ addColorStop() {} });
    c.stroke = () => { c.strokes++; if (c.shadowBlur > 0) c.blurredStrokes++; };
    c.drawImage = () => { c.images++; if (c.filter && c.filter !== 'none') c.filteredImages++; };
    contexts.push(c);
    return { width: 1920, height: 1080, getContext: () => c, ownerDocument: { createElement: canvas } };
  }
  const renderer = new PianoRenderer(canvas());
  const settings = { ...DEFAULT_SETTINGS };
  renderer.layout(settings, 1920);
  const notes = Array.from({ length: 30 }, (_, i) => ({ midi: 45 + i, time: 0, duration: 2, track: 0 }));
  const draw = (time = 1) => renderer.drawRibbons(notes, time, 900, 1080, 1920 / 1440, settings);
  return { renderer, contexts, settings, draw };
}

test('dense ribbons use one reduced-resolution blur instead of 90 shadow passes', () => {
  const { renderer, contexts, draw } = fixture();
  draw();
  assert.equal(contexts[0].strokes, 90, 'sharp full-resolution paths remain');
  assert.equal(contexts[0].blurredStrokes, 0);
  assert.equal(contexts[0].images, 1);
  assert.equal(contexts[1].strokes, 90);
  assert.equal(contexts[2].filteredImages, 1);
  const layer = renderer.ribbonLayer;
  assert.ok(layer.source.canvas.width * layer.source.canvas.height < 1920 * 1080 / 4);
  draw(1.1);
  assert.equal(renderer.ribbonLayer, layer, 'reuse the same two GPU surfaces');
});

test('expired ribbons do not composite a stale glow surface', () => {
  const { contexts, draw } = fixture();
  draw(); draw(10);
  assert.equal(contexts[0].images, 1);
  assert.equal(contexts[2].filteredImages, 1);
});

test('glow disabled allocates no bloom targets', () => {
  const { contexts, settings, draw } = fixture();
  settings.glow = 0; draw();
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].blurredStrokes, 0);
  assert.equal(contexts[0].strokes, 90);
});

test('browsers without Canvas filters keep the direct glow path', () => {
  const { contexts, draw } = fixture(false);
  draw();
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].blurredStrokes, 90);
});
