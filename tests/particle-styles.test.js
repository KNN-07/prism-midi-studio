import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, PARTICLE_STYLES, PRESETS, sanitizeSettings } from '../src/model.js';
import { PianoRenderer } from '../src/renderer.js';

test('particle choices round-trip saved looks and older looks keep sparks', () => {
  for (const { id } of PARTICLE_STYLES) {
    assert.equal(sanitizeSettings(JSON.parse(JSON.stringify({ particleStyle: id }))).particleStyle, id);
  }
  for (const particleStyle of [undefined, null, 'unknown']) {
    assert.equal(sanitizeSettings({ particleStyle }).particleStyle, 'sparks');
  }
  for (const preset of PRESETS) {
    const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...preset.settings });
    for (const [key, value] of Object.entries(preset.settings)) assert.equal(settings[key], value);
    assert.equal(settings.particles, true);
  }
});

test('all particle styles are finite, distinct and deterministic across seeks', () => {
  let commands = [];
  const ctx = {};
  for (const name of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'fill', 'stroke', 'fillRect']) {
    ctx[name] = (...args) => {
      assert.ok(args.every(Number.isFinite));
      commands.push([name, ...args]);
    };
  }
  const renderer = new PianoRenderer({ getContext: () => ctx });
  renderer.keys.set(60, { center: 400 }); renderer.keyWidth = 20;
  const notes = [{ midi: 60, time: 0, duration: 2, track: 0 }];
  const signatures = new Set();
  for (const { id } of PARTICLE_STYLES) {
    const settings = { ...DEFAULT_SETTINGS, particleStyle: id };
    commands = [];
    renderer.drawParticles(notes, 1, 600, 720, 1, settings);
    const first = JSON.stringify(commands);
    assert.ok(commands.length > 0);
    signatures.add(first);
    renderer.drawParticles(notes, 0.2, 600, 720, 1, settings);
    commands = [];
    renderer.drawParticles(notes, 1, 600, 720, 1, settings);
    assert.equal(JSON.stringify(commands), first);
    assert.equal(ctx.globalAlpha, 1);
    assert.equal(ctx.globalCompositeOperation, 'source-over');
    commands = [];
    renderer.drawParticles(notes, 5, 600, 720, 1, settings);
    assert.equal(commands.length, 0, 'expired notes stop emitting');
  }
  assert.equal(signatures.size, PARTICLE_STYLES.length);
});
