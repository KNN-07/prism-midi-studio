import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, PRESETS, sanitizeSettings } from '../src/model.js';

test('missing or malformed settings fall back to an independent defaults object', () => {
  for (const value of [undefined, null, false, 42, 'invalid', []]) {
    const clean = sanitizeSettings(value);
    assert.deepEqual(clean, DEFAULT_SETTINGS);
    assert.notStrictEqual(clean, DEFAULT_SETTINGS);
  }
  const clean = sanitizeSettings();
  clean.colorA = '#ffffff';
  assert.equal(DEFAULT_SETTINGS.colorA, '#53e8ef');
});

test('wrong primitive types and unrecognized keys cannot alter the settings schema', () => {
  const wrongTypes = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, value]) =>
    [key, typeof value === 'number' ? '50' : typeof value === 'boolean' ? 0 : false]));
  wrongTypes.untrusted = 'discard me';
  wrongTypes.constructor = { prototype: { polluted: true } };
  const clean = sanitizeSettings(wrongTypes);
  assert.deepEqual(clean, DEFAULT_SETTINGS);
  assert.equal(Object.hasOwn(clean, 'untrusted'), false);
  assert.equal(Object.hasOwn(clean, 'constructor'), false);
  assert.equal({}.polluted, undefined);
});

test('numeric controls are clamped to renderable ranges and nonfinite values use defaults', () => {
  const clean = sanitizeSettings({
    particleAmount: -1, particleSpeed: 101, turbulence: -100, glow: 500,
    fallTime: 0, backgroundDim: 1000, keyboardHeight: 99, minNote: -40, maxNote: 200,
  });
  assert.equal(clean.particleAmount, 0);
  assert.equal(clean.particleSpeed, 100);
  assert.equal(clean.turbulence, 0);
  assert.equal(clean.glow, 100);
  assert.equal(clean.fallTime, 1);
  assert.equal(clean.backgroundDim, 100);
  assert.equal(clean.keyboardHeight, 30);
  assert.equal(clean.minNote, 0);
  assert.equal(clean.maxNote, 127);
  for (const value of [NaN, Infinity, -Infinity]) {
    const bad = Object.fromEntries(Object.entries(DEFAULT_SETTINGS)
      .filter(([, current]) => typeof current === 'number').map(([key]) => [key, value]));
    assert.deepEqual(sanitizeSettings(bad), DEFAULT_SETTINGS);
  }
});

test('pitch ranges use integer MIDI keys and recover from empty or reversed ranges', () => {
  const fractional = sanitizeSettings({ minNote: 21.2, maxNote: 108.4 });
  assert.equal(fractional.minNote, 21);
  assert.equal(fractional.maxNote, 108);
  for (const range of [{ minNote: 70, maxNote: 70 }, { minNote: 100, maxNote: 30 }]) {
    const clean = sanitizeSettings(range);
    assert.equal(clean.minNote, DEFAULT_SETTINGS.minNote);
    assert.equal(clean.maxNote, DEFAULT_SETTINGS.maxNote);
  }
});

test('only supported color values and style modes reach the renderer', () => {
  for (const color of ['red', '#fff', '#12345678', '#gg0000', '', 'url(https://example.com)']) {
    const clean = sanitizeSettings({ colorA: color, colorB: color, background: color });
    for (const key of ['colorA', 'colorB', 'background']) assert.equal(clean[key], DEFAULT_SETTINGS[key]);
  }
  const valid = sanitizeSettings({ colorA: '#AABBcc', colorB: '#000000', background: '#123456' });
  assert.equal(valid.colorA, '#AABBcc');
  assert.equal(valid.colorB, '#000000');
  assert.equal(valid.background, '#123456');
  assert.equal(sanitizeSettings({ colorMode: 'unknown' }).colorMode, 'gradient');
  assert.equal(sanitizeSettings({ noteStyle: 'unknown' }).noteStyle, 'glass');
  for (const colorMode of ['gradient', 'track', 'rainbow', 'single']) assert.equal(sanitizeSettings({ colorMode }).colorMode, colorMode);
  for (const noteStyle of ['glass', 'solid', 'outline']) assert.equal(sanitizeSettings({ noteStyle }).noteStyle, noteStyle);
});

test('valid presets and disabled effects survive sanitization', () => {
  for (const preset of PRESETS) {
    const input = { ...DEFAULT_SETTINGS, ...preset.settings, preset: preset.id };
    assert.deepEqual(sanitizeSettings(input), input);
  }
  const clean = sanitizeSettings({ particles: false, trails: false, saber: false, keyboard: false, grid: false, labels: true });
  for (const key of ['particles', 'trails', 'saber', 'keyboard', 'grid']) assert.equal(clean[key], false);
  assert.equal(clean.labels, true);
});
