import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameLoop, FrameCadence } from '../src/frame-loop.js';

function clock(draw) {
  const callbacks = new Map();
  let id = 0;
  const loop = new FrameLoop(draw, {
    request: callback => { callbacks.set(++id, callback); return id; },
    cancel: handle => callbacks.delete(handle),
  });
  return { loop, callbacks, step(now) { const next = callbacks.entries().next().value; assert.ok(next); callbacks.delete(next[0]); next[1](now); } };
}

test('idle frames coalesce invalidations and stop requesting animation frames', () => {
  const times = [];
  const c = clock((now, dt) => { times.push(dt); return false; });
  c.loop.invalidate(); c.loop.invalidate(); c.loop.invalidate();
  assert.equal(c.callbacks.size, 1);
  c.step(1000);
  assert.equal(c.callbacks.size, 0);
  c.loop.invalidate(); c.step(100000);
  assert.deepEqual(times, [0, 0], 'waking after idle must not advance playback');
});

test('continuous frames advance time, bound stalls, and cancel on hide', () => {
  const times = [];
  const c = clock((now, dt) => { times.push(dt); return true; });
  c.loop.invalidate(); c.step(1000); c.step(1020); c.step(3020);
  assert.deepEqual(times, [0, .02, .1]);
  assert.equal(c.callbacks.size, 1);
  c.loop.stop(); assert.equal(c.callbacks.size, 0);
  c.loop.invalidate(); c.step(10000); assert.equal(times.at(-1), 0);
});

test('an invalidation during drawing survives an otherwise idle frame', () => {
  const c = clock(() => { c.loop.invalidate(); return false; });
  c.loop.invalidate(); c.step(1000);
  assert.equal(c.callbacks.size, 1);
});

test('export cadence honors 30 and 60 fps on 60, 120 and 144 Hz displays', () => {
  for (const fps of [30, 60]) for (const hz of [60, 120, 144]) {
    const cadence = new FrameCadence(fps);
    let frames = 0;
    for (let tick = 0; tick < hz * 10; tick++) if (cadence.due(tick * 1000 / hz)) frames++;
    assert.equal(frames, fps * 10, `${fps} fps on ${hz} Hz`);
  }
});

test('cadence recovers from stalls without duplicate frames or a catch-up burst', () => {
  const cadence = new FrameCadence(30);
  assert.equal(cadence.due(0), true);
  assert.equal(cadence.due(12), false);
  assert.equal(cadence.due(1030), true);
  assert.equal(cadence.due(1030), false);
  assert.equal(cadence.due(1034), true);
});
