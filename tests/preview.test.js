import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSize, previewProfile } from '../src/preview.js';
import { FrameCadence } from '../src/frame-loop.js';

test('balanced preview keeps small retina canvases sharp and caps 4K at Full HD', () => {
  assert.deepEqual(previewSize(800, 450, 2), { width: 1600, height: 900 });
  assert.deepEqual(previewSize(3840, 2160, 1), { width: 1920, height: 1080 });
  assert.deepEqual(previewSize(1920, 1080, 2), { width: 1920, height: 1080 });
});

test('native and low-power modes have independent preview budgets', () => {
  assert.deepEqual(previewSize(1920, 1080, 2, 'native'), { width: 3840, height: 2160 });
  assert.deepEqual(previewSize(1920, 1080, 2, 'economy'), { width: 1280, height: 720 });
  assert.equal(previewProfile('economy').fps, 30);
  assert.equal(previewProfile('invalid').fps, 60);
});

test('pixel budget preserves non-widescreen aspect ratios and handles collapsed stages', () => {
  for (const [width, height] of [[1600, 1600], [3000, 500], [500, 3000]]) {
    const actual = previewSize(width, height, 2);
    assert.ok(actual.width * actual.height <= 1920 * 1080);
    assert.ok(Math.abs(actual.width / actual.height - width / height) < .01);
  }
  assert.deepEqual(previewSize(0, 0, 2), { width: 1, height: 1 });
});

test('preview cadence limits GPU drawing on high refresh rate displays', () => {
  for (const quality of ['balanced', 'economy', 'native']) for (const hz of [60, 120, 144, 240]) {
    const { fps } = previewProfile(quality), cadence = new FrameCadence(fps);
    let draws = 0;
    for (let tick = 0; tick < hz * 5; tick++) if (cadence.due(tick * 1000 / hz)) draws++;
    assert.equal(draws, fps * 5);
  }
});
