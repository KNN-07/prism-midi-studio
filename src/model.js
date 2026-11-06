/** Shared model. Note: { midi, time, duration, velocity (0..1), track, channel? }.
 * Song: { name, notes, duration, bpm, tracks: [{name, count}], tempos? }.
 * All times are seconds; MIDI pitches 0..127. */
export const DEFAULT_SETTINGS = Object.freeze({
  preset: 'aurora', colorMode: 'gradient', colorA: '#53e8ef', colorB: '#b79aff',
  particles: true, particleAmount: 65, particleSpeed: 45, turbulence: 55,
  glow: 70, trails: true, saber: true, keyboard: true, grid: true,
  noteStyle: 'glass', fallTime: 3.8, background: '#060910', backgroundDim: 45,
  keyboardHeight: 17, minNote: 21, maxNote: 108, labels: false,
});

export const PRESETS = [
  { id: 'aurora', name: 'Aurora', subtitle: 'A little otherworldly', colors: ['#53e8ef', '#b79aff'], settings: { colorA: '#53e8ef', colorB: '#b79aff', colorMode: 'gradient', noteStyle: 'glass', particleAmount: 65, turbulence: 55, glow: 70, trails: true, saber: true } },
  { id: 'ember', name: 'Ember', subtitle: 'Warmth in every note', colors: ['#ffc26f', '#ff6389'], settings: { colorA: '#ffc26f', colorB: '#ff6389', colorMode: 'gradient', noteStyle: 'glass', particleAmount: 80, turbulence: 35, glow: 85, trails: true, saber: true } },
  { id: 'nocturne', name: 'Nocturne', subtitle: 'Quiet, after hours', colors: ['#7da4ff', '#e1dcff'], settings: { colorA: '#7da4ff', colorB: '#e1dcff', colorMode: 'track', noteStyle: 'solid', particleAmount: 28, turbulence: 25, glow: 45, trails: false, saber: true } },
  { id: 'spectrum', name: 'Spectrum', subtitle: 'All the colors of sound', colors: ['#69ffb6', '#ff85e6'], settings: { colorA: '#69ffb6', colorB: '#ff85e6', colorMode: 'rainbow', noteStyle: 'outline', particleAmount: 75, turbulence: 80, glow: 80, trails: true, saber: true } },
];

export function sanitizeSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const result = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(result)) {
    if (typeof input[key] === typeof result[key]) result[key] = input[key];
  }
  const ranges = { particleAmount: [0,100], particleSpeed: [0,100], turbulence: [0,100], glow: [0,100], fallTime: [1,8], backgroundDim: [0,100], keyboardHeight: [10,30], minNote: [0,126], maxNote: [1,127] };
  for (const [key,[min,max]] of Object.entries(ranges)) result[key] = Number.isFinite(result[key]) ? Math.min(max, Math.max(min, result[key])) : DEFAULT_SETTINGS[key];
  result.minNote = Math.round(result.minNote);
  result.maxNote = Math.round(result.maxNote);
  if (result.maxNote <= result.minNote) { result.minNote = 21; result.maxNote = 108; }
  for (const key of ['colorA','colorB','background']) if (!/^#[a-f\d]{6}$/i.test(result[key])) result[key] = DEFAULT_SETTINGS[key];
  if (!['gradient','track','rainbow','single'].includes(result.colorMode)) result.colorMode = 'gradient';
  if (!['glass','solid','outline'].includes(result.noteStyle)) result.noteStyle = 'glass';
  return result;
}
