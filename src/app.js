import { DEFAULT_SETTINGS, PARTICLE_STYLES, PRESETS, sanitizeSettings } from './model.js';
import { createDemoSong, parseMidi, encodeMidi } from './midi.js';
import { PianoAudio } from './audio.js';
import { PianoRenderer } from './renderer.js';
import { LiveMidi } from './live-midi.js';
import { FrameLoop, FrameCadence } from './frame-loop.js';
import { previewProfile, previewSize } from './preview.js';

const paths = {
  prism: '<path d="M12 2 23 22H1Z"/><path d="m12 2 4 20M1 22l14-11"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>', pause: '<path d="M8 5h2v14H8zM15 5h2v14h-2z"/>',
  back: '<path d="M5 5v14m14-14L8 12l11 7Z"/>', loop: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',
  music: '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  folder: '<path d="M3 6V4h7l2 3h9v13H3Z"/>',
  piano: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 5v14m4-14v14m4-14v14m4-14v14M6 5v7m8-7v7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>', check: '<path d="m5 12 4 4L19 6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 5 5 3-3 4 4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  fit: '<path d="M4 4v16M20 4v16m-6-12 4 4-4 4M10 8l-4 4 4 4M6 12h12"/>',
  sliders: '<path d="M4 5h7m5 0h4M4 12h2m5 0h9M4 19h10m5 0h1"/><circle cx="13" cy="5" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="19" r="2"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>',
  glow: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4Zm12-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4Zm13 1 5 5m0-5-5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  reset: '<path d="M3 3v6h6M3 9a9 9 0 1 1 0 6"/>',
  camera: '<path d="M8 6l2-3h4l2 3h5v14H3V6Z"/><circle cx="12" cy="13" r="4"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-4v12l-6-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01"/>',
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.music}</svg>`;
const $ = (selector) => document.querySelector(selector);
const formatTime = (time) => `${String(Math.floor(Math.max(0,time) / 60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,time) % 60)).padStart(2,'0')}`;
const storageKey = 'prism-midi-settings-v1';
let settings;
try { settings = sanitizeSettings(JSON.parse(localStorage.getItem(storageKey) || '{}')); } catch { settings = { ...DEFAULT_SETTINGS }; }
const audio = new PianoAudio();
let song = createDemoSong();
let time = Math.min(8.5, song.duration / 3), playing = false, loop = false, speed = 1, volume = 0.65;
let background = null, backgroundUrl = null, backgroundOffset = 0;
let liveMode = false, midiAccess = null, midiInput = null, liveStarted = 0;
const liveNotes = new Map(), computerHeld = new Map();
const liveSong = { notes: [] };
let liveSnapshot = [], liveSnapshotDirty = false;
const live = new LiveMidi(audio, { onStart: beginLive, getTime: () => performance.now()/1000-liveStarted, onChange: () => { liveSnapshotDirty = true; requestFrame(); }, onError: () => toast('Your browser could not start audio.',true) }, liveNotes);
let recording = null, preparingRecording = false, toastTimer, dragDepth = 0, settingsTimer;
let renderedVideo = null;

function slider(key, label, min, max, step = 1, suffix = '%') {
  return `<div class="slider-row"><label class="slider-label" for="setting-${key}">${label}<output id="value-${key}"></output></label><input type="range" id="setting-${key}" data-setting="${key}" data-unit="${suffix}" min="${min}" max="${max}" step="${step}"></div>`;
}
function toggle(key, label, description = '') {
  return `<label class="toggle-row" for="setting-${key}"><span>${label}${description ? `<small>${description}</small>` : ''}</span><input class="toggle" type="checkbox" role="switch" id="setting-${key}" data-setting="${key}"></label>`;
}
$('#app').innerHTML = `
  <header class="topbar">
    <div class="brand">${icon('prism','brand-mark')}<div><div class="wordmark">PRISM</div><div class="brand-caption">MIDI VISUAL STUDIO</div></div></div>
    <nav class="nav" aria-label="Main"><button class="active" id="studio-nav">Studio</button><button id="help-nav">How it works ${icon('chevron')}</button></nav>
    <div class="top-actions"><button class="btn subtle" id="import-top">${icon('upload')} Import MIDI</button><button class="btn save-button" id="save-look">${icon('download')}<span class="save-label">Save look</span></button><button class="btn primary" id="export-open">${icon('video')} Export video</button></div>
  </header>
  <div class="workspace">
    <aside class="library" aria-label="Project library">
      <div><div class="eyebrow">Your studio</div><div class="project-name">${icon('folder')} Untitled session</div></div>
      <section><div class="library-label"><span class="eyebrow">Performance</span><span>01</span></div><button class="song-card" id="demo-button" title="Load the original demo performance">${icon('music')}<span><strong id="song-card-name">Midnight Bloom</strong><small id="song-card-meta">Original demo · piano</small></span></button><button class="import-button" id="import-side">${icon('upload')} Drop or import a MIDI file</button><p class="hint">.mid or .midi · stays on your device</p></section>
      <section><div class="eyebrow">Live input</div><button class="side-action" id="connect-midi"><span class="status-dot" id="midi-dot"></span><span id="midi-label">Connect a keyboard</span>${icon('chevron')}</button><p class="hint">Or play with your computer keys<br>A W S E D F T G Y H U J K</p></section>
      <section><div class="eyebrow">Your scene</div><button class="side-action" id="background-side">${icon('image')} Add image or video ${icon('chevron')}</button><button class="side-action" id="load-look">${icon('sliders')} Load a saved look ${icon('chevron')}</button></section>
      <div class="privacy"><strong>${icon('shield')} Local by design</strong>Your music and footage stay on this device. No uploads. Just your creativity.</div>
    </aside>
    <main class="editor">
      <div class="editor-title"><div><h1>Let your music be seen.</h1><p>Your performance. A whole new light.</p></div><span class="chip"><span class="status-dot"></span> LIVE PREVIEW</span></div>
      <div class="stage-wrapper"><div class="stage-toolbar"><span class="eyebrow">Canvas <span style="color:#535c6c;margin:0 5px">/</span> <span id="preset-heading">Aurora</span></span><div class="stage-options"><span>16:9</span><button class="tool-icon" id="fit-keys" title="Fit keyboard to this performance" aria-label="Fit keyboard to performance">${icon('fit')}</button><button class="tool-icon" id="screenshot" title="Save a PNG screenshot" aria-label="Save PNG screenshot">${icon('camera')}</button><button class="tool-icon" id="fullscreen" title="Fullscreen preview" aria-label="Fullscreen preview">${icon('expand')}</button></div></div>
        <div class="stage" id="stage"><canvas id="visualizer" aria-label="Piano visualization preview"></canvas><div class="stage-overlay"><span id="stage-title">MIDNIGHT BLOOM</span><p>PRISM / PIANO SESSIONS</p></div><span class="recording-indicator" id="rec-indicator">● REC</span></div>
        <div class="stage-footer"><span>${icon('music')}<span id="note-count"></span></span><span>${icon('piano')}<span id="key-count">88 keys</span></span><span id="bpm-info"></span><span class="engine"><span class="status-dot connected"></span> Real-time render</span></div>
      </div>
      <div class="recording-banner" id="recording-banner"><span id="recording-progress">Recording your performance…</span><button class="btn" id="recording-stop">Stop & preview</button></div>
      <div class="transport"><div class="timecode"><b id="current-time">00:08</b> <span>/ <span id="total-time">01:12</span></span></div><div class="playback-controls"><button class="tool-icon" id="restart" title="Back to start" aria-label="Back to start">${icon('back')}</button><button class="play-button" id="play" title="Play (Space)" aria-label="Play">${icon('play')}</button><button class="tool-icon" id="loop" aria-label="Toggle loop" aria-pressed="false" title="Loop (L)">${icon('loop')}</button><select class="speed" id="speed" aria-label="Playback speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></div><div class="volume-controls"><button class="tool-icon" id="mute" title="Mute (M)" aria-label="Mute">${icon('volume')}</button><input type="range" id="volume" min="0" max="100" value="65" aria-label="Volume"></div></div>
      <section class="timeline-section" aria-label="Performance timeline"><div class="timeline-heading"><span class="eyebrow">Performance timeline</span><span id="timeline-name">Midnight Bloom.mid</span></div><div class="timeline-ruler" id="timeline-ruler"></div><div class="timeline-track"><canvas id="timeline" aria-hidden="true"></canvas><div class="playhead" id="playhead"></div><input id="seek" type="range" min="0" max="72" step="0.01" value="8.5" aria-label="Seek performance"></div></section>
      <div class="editor-bottom">${icon('help')}<span>Make something worth listening to. And looking at.</span><button class="text-button mobile-tip" id="mobile-help">Help</button><span class="keyboard-hint"><span class="kbd">space</span> to play</span></div>
    </main>
    <aside class="inspector" aria-label="Visual customization"><div class="inspector-title"><h2>Make it yours</h2>${icon('sliders')}</div><div class="library-label"><span class="eyebrow">Start with a mood</span><span>${String(PRESETS.length).padStart(2, '0')} presets</span></div><div class="preset-grid">${PRESETS.map(p => `<button class="preset-card" data-preset="${p.id}" aria-label="${p.name} preset: ${p.subtitle}"><span class="preset-art" style="--c1:${p.colors[0]};--c2:${p.colors[1]}">${[18,28,14,33,19,25].map(h=>`<i style="height:${h}px"></i>`).join('')}</span><span class="preset-name">${p.name}<span class="preset-check"></span></span></button>`).join('')}</div>
      <div class="inspector-tabs" role="tablist" aria-label="Visual settings"><button role="tab" id="tab-effects" data-tab="effects" aria-controls="panel-effects" aria-selected="true" class="active">Effects</button><button role="tab" id="tab-color" data-tab="color" aria-controls="panel-color" aria-selected="false">Color</button><button role="tab" id="tab-scene" data-tab="scene" aria-controls="panel-scene" aria-selected="false">Scene</button></div>
      <div class="tab-panel" id="panel-effects" role="tabpanel" aria-labelledby="tab-effects"><section class="control-group"><label class="control-title" for="setting-particles"><span>${icon('sparkles')} Particles</span><input type="checkbox" class="toggle" role="switch" id="setting-particles" data-setting="particles"></label><label class="select-label" for="setting-particleStyle">Particle style</label><select class="select" data-setting="particleStyle" id="setting-particleStyle">${PARTICLE_STYLES.map(style => `<option value="${style.id}">${style.name}</option>`).join('')}</select>${slider('particleAmount','Density',0,100)}${slider('particleSpeed','Rise speed',0,100)}${slider('turbulence','Turbulence',0,100)}</section><section class="control-group"><div class="control-title"><span>${icon('glow')} Light & motion</span></div>${slider('glow','Bloom intensity',0,100)}${toggle('trails','Flowing ribbons','Soft trails that follow the music')}${toggle('saber','Saber line','A little energy at every strike')}<label class="select-label" for="setting-noteStyle">Note material</label><select class="select" data-setting="noteStyle" id="setting-noteStyle"><option value="glass">Luminous glass</option><option value="solid">Soft solid</option><option value="outline">Neon outline</option></select></section></div>
      <div class="tab-panel" id="panel-color" role="tabpanel" aria-labelledby="tab-color" hidden><section class="control-group"><div class="control-title"><span>${icon('sliders')} Palette</span></div><label class="select-label" for="setting-colorMode">Color mapping</label><select class="select" data-setting="colorMode" id="setting-colorMode"><option value="gradient">Across the keyboard</option><option value="track">By MIDI track</option><option value="rainbow">Rainbow spectrum</option><option value="single">Single color</option></select><div class="color-fields"><label class="color-field"><input type="color" data-setting="colorA" aria-label="First note color">Color A</label><label class="color-field"><input type="color" data-setting="colorB" aria-label="Second note color">Color B</label></div><p class="inline-note">Color flows through notes, particles, and the illuminated keyboard.</p></section><section class="control-group"><div class="control-title"><span>${icon('image')} Backdrop</span></div><label class="color-field"><input type="color" data-setting="background" aria-label="Background color">Canvas color</label>${slider('backgroundDim','Footage dimming',0,100)}</section></div>
      <div class="tab-panel" id="panel-scene" role="tabpanel" aria-labelledby="tab-scene" hidden><section class="control-group"><div class="control-title"><span>${icon('piano')} Keyboard & notes</span></div>${toggle('keyboard','Show keyboard')}${toggle('labels','Note names')}${toggle('grid','Octave guides')}${slider('fallTime','Look-ahead',1,8,0.1,'s')}${slider('keyboardHeight','Keyboard height',10,30)}<div class="range-values"><label class="select-label">Lowest MIDI note<input type="number" id="setting-minNote" data-setting="minNote" min="0" max="126"></label><label class="select-label">Highest MIDI note<input type="number" id="setting-maxNote" data-setting="maxNote" min="1" max="127"></label></div><button class="text-button" id="reset-range">Restore 88 keys</button></section><section class="control-group"><div class="control-title"><span>${icon('image')} Your footage</span></div><button class="btn upload-background" id="background-upload">${icon('upload')} Add image / video</button><p class="inline-note" id="background-name">Add a backdrop or a video of your performance. Video audio is muted.</p><label class="select-label" for="video-offset">Video starts at song time (seconds)</label><input class="number-input" type="number" id="video-offset" value="0" step="0.1" min="-600" max="600"><button class="text-button" id="remove-background" style="margin-top:10px">Remove background</button><button class="text-button" id="mobile-midi" style="margin-top:12px">${icon('piano')} Connect MIDI keyboard</button></section></div>
      <div class="inspector-bottom"><span id="saved-status">Changes saved on this device</span><button class="text-button" id="reset-settings">${icon('reset')} Reset</button></div>
    </aside>
  </div>
  <input type="file" id="midi-file" class="file-input" accept=".mid,.midi,audio/midi,audio/x-midi"><input type="file" id="background-file" class="file-input" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"><input type="file" id="look-file" class="file-input" accept=".json,application/json">
  <div class="toast" id="toast" role="status" aria-live="polite"></div><div class="drop-overlay" id="drop-overlay">Drop a MIDI file to bring it to light</div>
  <dialog id="export-dialog"><div class="dialog-heading"><h2>Make it a moving picture.</h2><button class="tool-icon" data-close="export-dialog" aria-label="Close export">${icon('close')}</button></div><p>Export your full performance with piano audio. Recording runs in real time; keep this tab visible until it finishes.</p><div class="field-grid"><label class="select-label">Resolution<select class="select" id="export-resolution"><option value="1280">HD · 1280 × 720</option><option value="1920">Full HD · 1920 × 1080</option></select></label><label class="select-label">Frame rate<select class="select" id="export-fps"><option value="30">30 fps</option><option value="60">60 fps</option></select></label></div><p class="inline-note">The recording starts at the beginning at 1× speed. The preview overlays and controls are excluded. Your current volume is used.</p><div class="dialog-actions"><button class="btn" id="export-png">${icon('camera')} Save image</button><button class="btn primary" id="export-start">${icon('video')} Record video</button></div></dialog>
  <dialog id="help-dialog"><div class="dialog-heading"><h2>From notes to light.</h2><button class="tool-icon" data-close="help-dialog" aria-label="Close help">${icon('close')}</button></div><ol class="steps"><li><strong>Bring your music.</strong> Import a .mid file, try the original demo, or connect a MIDI keyboard in a supported browser.</li><li><strong>Find your look.</strong> Start with a mood, then adjust particles, light, colors, and your background footage.</li><li><strong>Make it yours to share.</strong> Save a PNG or record a video with the built-in synthesized piano sound.</li></ol><div class="shortcut-list"><span class="kbd">Space</span><span>Play / pause</span><span class="kbd">← →</span><span>Seek backward / forward 5 seconds</span><span class="kbd">L / M</span><span>Loop / mute</span><span class="kbd">A W S E D F T G Y H U J K</span><span>Play one octave, from C4</span></div><p class="inline-note">Files are processed locally. Chromium browsers offer the fullest MIDI and recording support. This is an independent open-source project.</p><div class="dialog-actions"><button class="btn" id="download-demo">${icon('download')} Demo MIDI</button><button class="btn primary" data-close="help-dialog">Let's create</button></div></dialog>
  <dialog id="midi-dialog"><div class="dialog-heading"><h2>Play into the light.</h2><button class="tool-icon" data-close="midi-dialog" aria-label="Close MIDI input">${icon('close')}</button></div><p id="midi-message">Connect a USB MIDI keyboard, then choose it below. You can also play with the computer keyboard.</p><select class="select live-select" id="midi-devices" aria-label="MIDI input device"><option value="">No keyboard connected</option></select><p class="live-message">Computer keys: A W S E D F T G Y H U J K<br>Press Play to return to your MIDI performance.</p><div class="dialog-actions"><button class="btn" id="disconnect-midi">Disconnect</button><button class="btn primary" data-close="midi-dialog">Done</button></div></dialog>
  <dialog id="result-dialog"><div class="dialog-heading"><h2>Your music, in a new light.</h2><button class="tool-icon" data-close="result-dialog" aria-label="Close video preview">${icon('close')}</button></div><p>Your video is ready. Preview it here, then save it to your device.</p><video id="result-video" controls playsinline aria-label="Rendered video preview" style="width:100%;border-radius:6px;background:#060910"></video><p class="inline-note" id="result-details"></p><div class="dialog-actions"><button class="btn" data-close="result-dialog">Keep creating</button><button class="btn primary" id="save-video">${icon('download')} Download video</button></div></dialog>
`;

$('#panel-scene').insertAdjacentHTML('afterbegin', `<section class="control-group"><div class="control-title"><span>${icon('sliders')} Preview performance</span></div><label class="select-label" for="setting-previewQuality">Preview quality</label><select class="select" id="setting-previewQuality" data-setting="previewQuality"><option value="balanced">Balanced · up to 1080p / 60 fps</option><option value="economy">Low power · up to 720p / 30 fps</option><option value="native">Native resolution · up to 60 fps</option></select><p class="inline-note">Lower preview quality saves graphics power. Screenshots and video exports keep their chosen resolution.</p></section>`);
const canvas = $('#visualizer'), renderer = new PianoRenderer(canvas);
const frameLoop = new FrameLoop(frame), transportCadence = new FrameCadence(30);
let previewCadence = new FrameCadence(previewProfile(settings.previewQuality).fps);
let previewQuality = settings.previewQuality, previewDirty = true, previewVisible = true;
const transport = { play: $('#play'), time: $('#current-time'), seek: $('#seek'), playhead: $('#playhead'), progress: $('#recording-progress') };
let transportPlaying, transportTime = '', transportPosition = -1, timelineWidth = 0;
let timelineDirty = true, timelineSignature = '', timelineNotes = null, timelineLength = -1, timelineBounds = [21, 108];
function requestFrame() { previewDirty = true; if (!document.hidden) frameLoop.invalidate(); }
function resizePreview() {
  const rect = canvas.getBoundingClientRect();
  const size = previewSize(rect.width, rect.height, devicePixelRatio || 1, settings.previewQuality);
  renderer.resize(size.width, size.height);
  requestFrame();
}
function currentLiveNotes() {
  if (liveSnapshotDirty) { liveSnapshot = [...liveNotes.values()]; liveSnapshotDirty = false; }
  return liveSnapshot;
}
function toast(message, error = false) {
  clearTimeout(toastTimer); const node = $('#toast'); node.textContent = message;
  node.className = `toast visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => node.classList.remove('visible'), 4500);
}
function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(persistSettings, 150);
}
function persistSettings() {
  settingsTimer = null;
  try { localStorage.setItem(storageKey, JSON.stringify(settings)); $('#saved-status').textContent = 'Changes saved on this device'; }
  catch { $('#saved-status').textContent = 'Use Save look to keep your settings'; }
}
function fillRange(input) { const pct = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100; input.style.setProperty('--fill', `${pct}%`); }
function pitchBounds(notes) {
  let min = 127, max = 0;
  for (const note of notes) { min = Math.min(min, note.midi); max = Math.max(max, note.midi); }
  return notes.length ? [min, max] : [21, 108];
}
function updateSettingsUI() {
  document.querySelectorAll('[data-setting]').forEach(input => {
    const value = settings[input.dataset.setting];
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
    if (input.type === 'range') { fillRange(input); const output = $(`#value-${input.dataset.setting}`); if (output) output.textContent = `${value}${input.dataset.unit}`; }
  });
  document.querySelectorAll('[data-preset]').forEach(button => {
    const active = button.dataset.preset === settings.preset; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.querySelector('.preset-check').innerHTML = active ? icon('check') : '';
  });
  $('#preset-heading').textContent = PRESETS.find(p=>p.id === settings.preset)?.name || 'Custom look';
  $('#key-count').textContent = `${settings.maxNote - settings.minNote + 1} keys`;
  if (previewQuality !== settings.previewQuality) {
    previewQuality = settings.previewQuality;
    previewCadence = new FrameCadence(previewProfile(previewQuality).fps);
    resizePreview();
  }
  requestFrame();
}
function drawTimeline() {
  timelineDirty = true;
  requestFrame();
}
function paintTimeline() {
  timelineDirty = false;
  const el = $('#timeline'), rect = el.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
  if (timelineWidth !== rect.width) { timelineWidth = rect.width; transportPosition = -1; updateTransport(false); }
  const signature = `${width}:${height}:${song.duration}:${settings.colorMode}:${settings.colorA}:${settings.colorB}`;
  if (timelineNotes === song.notes && timelineLength === song.notes.length && timelineSignature === signature) return;
  if (timelineNotes !== song.notes || timelineLength !== song.notes.length) timelineBounds = pitchBounds(song.notes);
  timelineNotes = song.notes; timelineLength = song.notes.length; timelineSignature = signature;
  if (el.width !== width) el.width = width;
  if (el.height !== height) el.height = height;
  const ctx = el.getContext('2d'); ctx.clearRect(0,0,el.width,el.height);
  const [lo, hi] = timelineBounds;
  for (const note of song.notes) { const color = renderer.noteColor(note.midi,note.track,settings); ctx.fillStyle = `rgba(${color.join(',')},${0.35+note.velocity*.5})`; ctx.fillRect(note.time/song.duration*el.width, (1-(note.midi-lo)/(hi-lo+1))*(el.height-6), Math.max(1,note.duration/song.duration*el.width), Math.max(1.5,el.height/35)); }
}
function updateSongUI(isDemo = false) {
  $('#song-card-name').textContent = song.name; $('#song-card-meta').textContent = isDemo ? 'Original demo · piano' : `${song.tracks.length} tracks · MIDI`;
  $('#stage-title').textContent = song.name.toUpperCase(); $('#timeline-name').textContent = song.name;
  $('#note-count').textContent = `${song.notes.length.toLocaleString()} notes`; $('#bpm-info').textContent = `${Math.round(song.bpm)} BPM`;
  $('#total-time').textContent = formatTime(song.duration); $('#seek').max = song.duration;
  $('#timeline-ruler').innerHTML = Array.from({length:7},(_,i)=>`<span>${formatTime(song.duration*i/6)}</span>`).join('');
  updateTransport(); drawTimeline();
}
function updateTransport(invalidate = true) {
  if (transportPlaying !== playing) {
    transportPlaying = playing;
    transport.play.innerHTML = icon(playing ? 'pause' : 'play');
    transport.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    transport.play.title = `${playing ? 'Pause' : 'Play'} (Space)`;
  }
  const label = `${formatTime(time)} of ${formatTime(song.duration)}`;
  if (transportTime !== label) {
    transportTime = label; transport.time.textContent = formatTime(time);
    transport.seek.setAttribute('aria-valuetext', label);
    if (recording) transport.progress.textContent = `Recording · ${formatTime(time)} / ${formatTime(song.duration)}`;
  }
  if (transportPosition !== time) {
    transportPosition = time; transport.seek.value = time;
    transport.playhead.style.transform = `translateX(${time / song.duration * timelineWidth}px)`;
  }
  if (invalidate) requestFrame();
}
function stopLive() { live.reset(); computerHeld.clear(); liveMode = false; $('#stage-title').textContent = song.name.toUpperCase(); }
async function setPlaying(value) {
  if (recording || preparingRecording) return;
  if (value) { try { await audio.unlock(); } catch { toast('Your browser could not start audio.',true); return; } stopLive(); if (time >= song.duration) time = 0; }
  playing = value; if (!value) audio.stop(); frameLoop.resetTime(); updateTransport();
}
function seek(value) {
  if (recording || preparingRecording) return; stopLive(); time = Math.max(0,Math.min(song.duration,Number(value))); audio.stop(); renderer.clearParticles(); updateTransport(); syncVideo(true);
}
function loadSong(nextSong, isDemo = false) {
  if (recording || preparingRecording) return toast('Finish the recording before changing the performance.',true);
  playing = false; audio.stop(); stopLive(); song = nextSong; time = 0; renderer.clearParticles(); updateSongUI(isDemo); syncVideo(true);
}
async function importMidi(file) {
  if (!file) return;
  if (recording || preparingRecording) return toast('Finish the recording before importing a performance.',true);
  if (file.size > 20*1024*1024) return toast('Please choose a MIDI file smaller than 20 MB.',true);
  try { const next = parseMidi(await file.arrayBuffer(), file.name.replace(/\.midi?$/i,'')); if (!next.notes.length) throw new Error('This MIDI file has no playable notes.'); loadSong(next); toast(`Loaded ${next.name} · ${next.notes.length.toLocaleString()} notes`); }
  catch (error) { toast(`Could not open MIDI: ${error.message}`,true); }
}
function download(blob,name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),30000); }
function safeName(name) { return name.replace(/[^a-z\d_-]+/gi,'-').replace(/^-|-$/g,'').slice(0,70) || 'prism'; }
function saveLook() { download(new Blob([JSON.stringify({app:'PRISM',version:1,settings},null,2)],{type:'application/json'}), `prism-${safeName(settings.preset)}.json`); toast('Your look is saved. Load it again from Your scene.'); }
async function loadLook(file) {
  if (!file) return;
  try { if (file.size>100000) throw new Error('File too large'); const data = JSON.parse(await file.text()); if (data.app !== 'PRISM' || !data.settings || data.version !== 1) throw new Error('Choose a PRISM look file'); settings = sanitizeSettings(data.settings); updateSettingsUI(); saveSettings(); drawTimeline(); toast('Your saved look is ready.'); }
  catch (error) { toast(`Could not load this look: ${error.message}`,true); }
}
function openDialog(id) { const dialog = $(`#${id}`); if (!dialog.open) dialog.showModal(); }
function syncVideo(force = false) {
  if (!(background instanceof HTMLVideoElement) || !Number.isFinite(background.duration)) return;
  if (!previewVisible && !recording) { if (!background.paused) background.pause(); return; }
  const desired = Math.max(0,Math.min(background.duration - .01,time-backgroundOffset));
  if (background.playbackRate !== speed) background.playbackRate = speed;
  if (force || Math.abs(background.currentTime-desired) > .3) background.currentTime = desired;
  if (playing && (previewVisible || recording) && time>=backgroundOffset && desired<background.duration-.03) { if (background.paused) background.play().catch(()=>{}); } else if (!background.paused) background.pause();
}
async function setBackground(file) {
  if (!file) return;
  if (recording || preparingRecording) return toast('Finish the recording before changing footage.',true);
  const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name);
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) return toast('Choose an image or a video file.',true);
  const url = URL.createObjectURL(file);
  const media = isVideo ? document.createElement('video') : new Image();
  if (isVideo) { media.muted = true; media.playsInline = true; media.preload = 'auto'; }
  try {
    await new Promise((resolve,reject)=>{ media.addEventListener(isVideo?'loadeddata':'load',resolve,{once:true}); media.addEventListener('error',()=>reject(new Error('This media format is not supported by your browser.')),{once:true}); media.src=url; });
    if (background instanceof HTMLVideoElement) background.pause(); if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
    background = media; backgroundUrl = url;
    if (isVideo) media.addEventListener('seeked', requestFrame);
    $('#background-name').textContent = file.name; syncVideo(true); requestFrame(); toast('Your scene is ready. Adjust dimming in Color.');
  } catch(error) { URL.revokeObjectURL(url); toast(error.message,true); }
}
function screenshot() {
  const output = document.createElement('canvas'), painter = new PianoRenderer(output); painter.resize(1920,1080);
  painter.render({song:liveMode?liveSong:song,time:liveMode?performance.now()/1000-liveStarted:time,dt:0,settings,liveNotes:currentLiveNotes(),background,playing});
  output.toBlob(blob=>{ if(blob) { download(blob,`${safeName(song.name)}-prism.png`); toast('Saved a Full HD snapshot.'); } else toast('Screenshot could not be saved.',true); },'image/png');
}
async function startRecording() {
  if (recording || preparingRecording) return;
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return toast('Video recording is not supported in this browser. Try Chrome or Edge.',true);
  if (liveMode) return toast('Press Play to return to your MIDI performance before exporting.',true);
  const mimeType = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
  if (!mimeType) return toast('No supported video recording format was found.',true);
  preparingRecording = true; setRecordingControls(true); $('#export-start').disabled = true; $('#export-start').textContent = 'Preparing…';
  let stream;
  try {
    await audio.unlock(); audio.stop(); playing = false; time = 0; speed = 1; $('#speed').value = '1';
    // Let the synth's release and delay tails settle before capturing a new take.
    await new Promise(resolve => setTimeout(resolve, 500));
    if (background instanceof HTMLVideoElement && Number.isFinite(background.duration)) {
      background.pause();
      const target = Math.max(0, Math.min(background.duration - .01, -backgroundOffset));
      if (Math.abs(background.currentTime - target) > .01) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { background.removeEventListener('seeked', done); reject(new Error('Background video seek timed out. Try a different video.')); }, 8000);
          function done() { clearTimeout(timeout); resolve(); }
          background.addEventListener('seeked', done, { once: true }); background.currentTime = target;
        });
      }
    }
    const output = document.createElement('canvas'), painter = new PianoRenderer(output);
    const width = Number($('#export-resolution').value), fps = Number($('#export-fps').value); painter.resize(width,Math.round(width*9/16));
    painter.render({song,time,dt:0,settings,background,playing:false});
    stream = output.captureStream(0);
    let captureTrack = stream.getVideoTracks()[0];
    // Explicit capture keeps drawing and encoding on the same frame clock.
    // Older browsers retain their native automatic capture cadence.
    if (typeof captureTrack.requestFrame !== 'function') {
      for (const track of stream.getTracks()) track.stop();
      stream = output.captureStream(fps); captureTrack = null;
    }
    const audioStream = audio.getStream(); for (const track of audioStream.getAudioTracks()) stream.addTrack(track.clone());
    const recorder = new MediaRecorder(stream,{mimeType,videoBitsPerSecond:width>=1920?12000000:7000000});
    const chunks=[]; recording = {recorder,stream,painter,output,chunks,mimeType,error:false,cadence:new FrameCadence(fps),captureTrack,frameVersion:0,previewVersion:-1};
    recorder.ondataavailable = event => { if(event.data.size) chunks.push(event.data); };
    recorder.onerror = event => { if(recording) recording.error=true; toast(`Recording failed: ${event.error?.message || 'browser encoder error'}`,true); finishRecording(); };
    recorder.onstop = () => {
      const failed=recording?.error; for(const track of stream.getTracks()) track.stop();
      if(chunks.length && !failed) {
        if(renderedVideo) URL.revokeObjectURL(renderedVideo.url);
        const blob = new Blob(chunks,{type:mimeType});
        renderedVideo = { blob, url: URL.createObjectURL(blob), filename: `${safeName(song.name)}-prism.${mimeType.includes('mp4')?'mp4':'webm'}` };
        $('#result-video').src = renderedVideo.url;
        $('#result-details').textContent = `${width} × ${Math.round(width*9/16)} · ${fps} fps · ${(blob.size/1024/1024).toFixed(1)} MB · piano audio included`;
        openDialog('result-dialog');
      }
      recording=null; playing=false; audio.stop(); $('#recording-banner').classList.remove('visible'); $('#rec-indicator').style.display='none'; setRecordingControls(false); updateTransport();
      if(!failed && !chunks.length) toast('The recording was empty. Please try again.',true);
    };
    if (document.hidden) throw new Error('Keep this tab visible to start a recording.');
    if (!$('#export-dialog').open) throw new Error('Recording cancelled.');
    recorder.start(1000); preparingRecording = false; playing = true; frameLoop.resetTime(); transportTime = ''; syncVideo(true);
    $('#export-dialog').close(); $('#recording-banner').classList.add('visible'); $('#rec-indicator').style.display='block'; setRecordingControls(true); updateTransport(); toast('Recording started. Keep this tab visible.');
  } catch(error) { if(stream) for(const track of stream.getTracks()) track.stop(); recording=null; setRecordingControls(false); updateTransport(); toast(`Could not start recording: ${error.message}`,true); }
  finally { preparingRecording = false; $('#export-start').disabled = false; $('#export-start').innerHTML = `${icon('video')} Record video`; }
}
function setRecordingControls(disabled) { for(const id of ['play','restart','seek','speed','loop','import-top','import-side','demo-button','export-open','connect-midi','mobile-midi','background-upload','background-side','video-offset']) $(`#${id}`).disabled=disabled; }
function finishRecording() { if(recording && recording.recorder.state !== 'inactive') { playing=false; audio.stop(); recording.recorder.stop(); } }

function beginLive() {
  if(recording || preparingRecording) return false;
  if(!liveMode) { playing=false; audio.stop(); liveMode=true; liveStarted=performance.now()/1000; $('#stage-title').textContent='LIVE PERFORMANCE'; updateTransport(); }
  return true;
}
async function liveOn(midi,velocity=0.75,channel=0) {
  return live.noteOn(midi,velocity,channel);
}
function liveOff(midi,channel=0) { live.noteOff(midi,channel); }
function disconnectMidi() { if(midiInput) midiInput.onmidimessage=null; midiInput=null; stopLive(); audio.stop(); $('#midi-dot').classList.remove('connected'); $('#midi-label').textContent='Connect a keyboard'; $('#midi-devices').value=''; }
function selectMidi(id) {
  disconnectMidi(); if(!id) return;
  midiInput=midiAccess?.inputs.get(id); if(!midiInput) return;
  midiInput.onmidimessage = ({data}) => { const type=data[0]&0xf0, channel=data[0]&0x0f; if(type===0x90&&data[2]>0) void liveOn(data[1],data[2]/127,channel); else if(type===0x80||(type===0x90&&data[2]===0)) liveOff(data[1],channel); else if(type===0xb0) live.controlChange(data[1],data[2],channel); };
  $('#midi-devices').value=id; $('#midi-dot').classList.add('connected'); $('#midi-label').textContent='Keyboard connected'; toast(`Connected to ${midiInput.name || 'MIDI keyboard'}`);
}
function refreshMidiDevices() {
  const id=midiInput?.id, select=$('#midi-devices'); select.replaceChildren(new Option('Choose a keyboard…',''));
  for(const input of midiAccess.inputs.values()) if(input.state==='connected') select.add(new Option(input.name||'MIDI input',input.id));
  if(id && midiAccess.inputs.get(id)?.state==='connected') select.value=id; else if(id) disconnectMidi();
  $('#midi-message').textContent=select.options.length>1?'Choose your keyboard below. Play any note to start the live visualization.':'No MIDI input found. Connect a USB keyboard; it will appear here automatically. You can also use your computer keys.';
}
async function connectMidi() {
  openDialog('midi-dialog');
  if(!navigator.requestMIDIAccess) { $('#midi-message').textContent='Web MIDI is unavailable here. Use Chrome or Edge on localhost or HTTPS, or play using your computer keyboard.'; return; }
  try { midiAccess ||= await navigator.requestMIDIAccess({sysex:false}); refreshMidiDevices(); midiAccess.onstatechange=refreshMidiDevices; if(!midiInput&&midiAccess.inputs.size===1) selectMidi([...midiAccess.inputs.keys()][0]); }
  catch(error) { $('#midi-message').textContent=`MIDI access was not granted. Check browser permissions and try again. ${error.message || ''}`; }
}

document.querySelectorAll('[data-setting]').forEach(input=>input.addEventListener('input',()=>{
  const key=input.dataset.setting; const value=input.type==='checkbox'?input.checked:['range','number'].includes(input.type)?Number(input.value):input.value;
  settings=sanitizeSettings({...settings,[key]:value,preset:key==='previewQuality'?settings.preset:'custom'}); updateSettingsUI(); saveSettings(); drawTimeline();
}));
document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>{ const preset=PRESETS.find(p=>p.id===button.dataset.preset); settings=sanitizeSettings({...settings,...preset.settings,preset:preset.id}); updateSettingsUI(); saveSettings(); drawTimeline(); }));
function selectTab(button) { document.querySelectorAll('[data-tab]').forEach(tab=>{ const active=button===tab; tab.classList.toggle('active',active); tab.setAttribute('aria-selected',String(active)); tab.tabIndex=active?0:-1; $(`#panel-${tab.dataset.tab}`).hidden=!active; }); }
document.querySelectorAll('[data-tab]').forEach((button,index)=>{ button.addEventListener('click',()=>selectTab(button)); button.addEventListener('keydown',event=>{ if(['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) { event.preventDefault(); const tabs=[...document.querySelectorAll('[data-tab]')]; const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3; selectTab(tabs[next]); tabs[next].focus(); } }); }); selectTab($('#tab-effects'));
for(const id of ['import-top','import-side']) $(`#${id}`).onclick=()=>$('#midi-file').click();
$('#midi-file').onchange=event=>{void importMidi(event.target.files[0]);event.target.value='';};
$('#background-file').onchange=event=>{void setBackground(event.target.files[0]);event.target.value='';};
$('#look-file').onchange=event=>{void loadLook(event.target.files[0]);event.target.value='';};
for(const id of ['background-side','background-upload']) $(`#${id}`).onclick=()=>$('#background-file').click();
$('#load-look').onclick=()=>$('#look-file').click(); $('#save-look').onclick=saveLook;
$('#demo-button').onclick=()=>{loadSong(createDemoSong(),true);toast('Original demo loaded. Press play to listen.');};
$('#play').onclick=()=>void setPlaying(!playing); $('#restart').onclick=()=>seek(0); $('#seek').oninput=event=>seek(event.target.value);
$('#loop').onclick=()=>{ if(recording||preparingRecording)return; loop=!loop;$('#loop').classList.toggle('active',loop);$('#loop').setAttribute('aria-pressed',String(loop));};
$('#speed').onchange=event=>{speed=Number(event.target.value);audio.stop();};
$('#volume').oninput=event=>{volume=Number(event.target.value)/100;audio.setVolume(volume);fillRange(event.target);$('#mute').innerHTML=icon(volume?'volume':'mute');$('#mute').setAttribute('aria-label',volume?'Mute':'Unmute');};
$('#mute').onclick=()=>{$('#volume').value=volume?0:65;$('#volume').dispatchEvent(new Event('input'));};
$('#fit-keys').onclick=()=>{ const [min,max]=pitchBounds(song.notes); settings.minNote=Math.max(0,min-3);settings.maxNote=Math.min(127,max+3);settings.preset='custom';updateSettingsUI();saveSettings();toast('Keyboard fitted to your performance.');};
$('#reset-range').onclick=()=>{settings.minNote=21;settings.maxNote=108;updateSettingsUI();saveSettings();};
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#stage').requestFullscreen();}catch{toast('Fullscreen is unavailable in this browser.',true);}};
$('#screenshot').onclick=screenshot; $('#export-png').onclick=screenshot;
$('#export-open').onclick=()=>openDialog('export-dialog'); $('#export-start').onclick=()=>void startRecording(); $('#recording-stop').onclick=finishRecording;
$('#save-video').onclick=()=>{if(renderedVideo)download(renderedVideo.blob,renderedVideo.filename);};
$('#result-dialog').addEventListener('close',()=>$('#result-video').pause());
for(const id of ['help-nav','mobile-help']) $(`#${id}`).onclick=()=>openDialog('help-dialog');
$('#studio-nav').onclick=()=>{document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());$('#stage').scrollIntoView({behavior:'smooth',block:'center'});};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=> $(`#${button.dataset.close}`).close());
$('#download-demo').onclick=()=>download(new Blob([encodeMidi(createDemoSong())],{type:'audio/midi'}),'prism-first-light.mid');
$('#reset-settings').onclick=()=>{settings={...DEFAULT_SETTINGS};updateSettingsUI();saveSettings();drawTimeline();toast('The original Aurora look is restored.');};
$('#remove-background').onclick=()=>{if(recording||preparingRecording)return toast('Finish the recording first.',true);if(background instanceof HTMLVideoElement)background.pause();background=null;if(backgroundUrl)URL.revokeObjectURL(backgroundUrl);backgroundUrl=null;$('#background-name').textContent='Add a backdrop or a video of your performance. Video audio is muted.';requestFrame();};
$('#video-offset').onchange=event=>{backgroundOffset=Math.max(-600,Math.min(600,Number(event.target.value)||0));event.target.value=backgroundOffset;syncVideo(true);};
for(const id of ['connect-midi','mobile-midi']) $(`#${id}`).onclick=()=>void connectMidi();
$('#disconnect-midi').onclick=()=>{disconnectMidi();toast('MIDI keyboard disconnected.');}; $('#midi-devices').onchange=event=>selectMidi(event.target.value);

const computerKeys={KeyA:60,KeyW:61,KeyS:62,KeyE:63,KeyD:64,KeyF:65,KeyT:66,KeyG:67,KeyY:68,KeyH:69,KeyU:70,KeyJ:71,KeyK:72};
document.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||event.repeat||event.target.matches('input,select,textarea,[contenteditable]')||$('dialog[open]'))return;
  if(event.code==='Space'){event.preventDefault();void setPlaying(!playing);} else if(event.code==='ArrowLeft'){event.preventDefault();seek(time-5);} else if(event.code==='ArrowRight'){event.preventDefault();seek(time+5);} else if(event.code==='KeyL')$('#loop').click(); else if(event.code==='KeyM')$('#mute').click();
  else if(computerKeys[event.code]!==undefined){event.preventDefault();computerHeld.set(event.code,computerKeys[event.code]);void liveOn(computerKeys[event.code]);}
});
document.addEventListener('keyup',event=>{if(computerHeld.has(event.code)){liveOff(computerHeld.get(event.code));computerHeld.delete(event.code);}});
window.addEventListener('blur',()=>{for(const midi of computerHeld.values())liveOff(midi);computerHeld.clear();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(recording){finishRecording();toast('Recording ended early because the tab was hidden.');}else if(playing){playing=false;audio.stop();updateTransport();}stopLive();syncVideo();frameLoop.stop();}else requestFrame();});
window.addEventListener('pagehide',()=>{if(settingsTimer !== null && settingsTimer !== undefined){clearTimeout(settingsTimer);persistSettings();}});
window.addEventListener('dragenter',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dragDepth++;$('#drop-overlay').classList.add('visible');}});
window.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
window.addEventListener('dragleave',event=>{event.preventDefault();if(--dragDepth<=0){dragDepth=0;$('#drop-overlay').classList.remove('visible');}});
window.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;$('#drop-overlay').classList.remove('visible');const file=event.dataTransfer?.files[0];if(file)void importMidi(file);});

const resizeObserver=new ResizeObserver(()=>{resizePreview();drawTimeline();});resizeObserver.observe($('#stage'));resizeObserver.observe($('.timeline-track'));
if (typeof IntersectionObserver !== 'undefined') {
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    if (previewVisible === entry.isIntersecting) return;
    previewVisible = entry.isIntersecting;
    if (previewVisible) { syncVideo(true); requestFrame(); } else syncVideo();
  });
  visibilityObserver.observe(canvas);
}
function frame(now, dt) {
  if (document.hidden) return false;
  if(playing){time=Math.min(song.duration,time+dt*speed);if(time>=song.duration){if(recording)finishRecording();else if(loop){time=0;audio.stop();renderer.clearParticles();syncVideo(true);}else{playing=false;audio.stop();updateTransport();}}}
  audio.tick(song,time,playing,speed);syncVideo();
  if (timelineDirty) paintTimeline();
  const previewDue = previewVisible && (previewDirty || previewCadence.due(now));
  // Audio and transport keep their own clock even when the stage is offscreen
  // or a high-refresh display does not need another preview frame yet.
  if (!recording && !previewDue) {
    if(playing && transportCadence.due(now))updateTransport(false);
    return playing || (liveMode && liveNotes.size > 0 && previewVisible);
  }
  const renderTime=liveMode?now/1000-liveStarted:time;
  const data={song:liveMode?liveSong:song,time:renderTime,dt,settings,liveNotes:currentLiveNotes(),background,playing:playing||liveMode};
  if (recording) {
    if (!recording.captureTrack || recording.cadence.due(now) || !playing) {
      recording.painter.render(data);
      recording.captureTrack?.requestFrame();
      recording.frameVersion++;
    }
    // Preview and capture have independent cadences. Copy the latest output
    // when the preview is due, even if capture did not render on this tick.
    if (previewDue && (previewDirty || recording.previewVersion !== recording.frameVersion)) {
      renderer.ctx.drawImage(recording.output,0,0,canvas.width,canvas.height);
      recording.previewVersion = recording.frameVersion; previewDirty = false;
    }
  } else { renderer.render(data); previewDirty = false; }
  if(playing && transportCadence.due(now))updateTransport(false);
  return playing || (liveMode && liveNotes.size > 0 && previewVisible);
}
updateSettingsUI();updateSongUI(true);audio.setVolume(volume);fillRange($('#volume'));requestFrame();
