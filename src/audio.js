/** Small, sample-free piano synth and transport scheduler. */
export class PianoAudio {
  constructor() {
    this.context = null; this.volume = .65; this.voices = new Set(); this.liveVoices = new Map();
    this.song = null; this.nextIndex = 0; this.playing = false; this.lastTime = 0; this.lastContextTime = 0; this.speed = 1;
  }

  async unlock() {
    if (!this.context) {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) throw new Error('Web Audio is not supported in this browser.');
      this.context = new AudioContext();
      this.master = this.context.createGain(); this.master.gain.value = this.volume * .42;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -20; this.compressor.knee.value = 18; this.compressor.ratio.value = 6;
      this.master.connect(this.compressor); this.compressor.connect(this.context.destination);
      this.destination = this.context.createMediaStreamDestination(); this.compressor.connect(this.destination);
      const delay = this.context.createDelay(.5), feedback = this.context.createGain(), wet = this.context.createGain();
      delay.delayTime.value = .137; feedback.gain.value = .20; wet.gain.value = .10;
      this.reverb = delay; delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(this.master);
      const real = new Float32Array([0,1,.42,.19,.12,.055,.035,.015]);
      this.wave = this.context.createPeriodicWave(real, new Float32Array(real.length));
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  setVolume(value) {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.context) this.master.gain.setTargetAtTime(this.volume * .42, this.context.currentTime, .02);
  }

  _voice(midi, velocity, when, duration = 30) {
    if (!this.context || this.context.state !== 'running') return null;
    if (this.voices.size >= 64) this._release(this.voices.values().next().value, this.context.currentTime, .025);
    const ctx = this.context, frequency = 440 * 2 ** ((midi - 69) / 12), level = Math.max(.001, velocity) ** 1.35 * .42;
    const envelope = ctx.createGain(), tone = ctx.createBiquadFilter(), oscillator = ctx.createOscillator(), shimmer = ctx.createOscillator();
    tone.type = 'lowpass'; tone.frequency.setValueAtTime(Math.min(14000, 2300 + frequency * 2.3 + velocity * 4000), when); tone.Q.value = .35;
    oscillator.setPeriodicWave(this.wave); oscillator.frequency.value = frequency;
    shimmer.type = 'sine'; shimmer.frequency.value = frequency * 2.002;
    const shimmerGain = ctx.createGain(); shimmerGain.gain.value = .055;
    oscillator.connect(tone); shimmer.connect(shimmerGain); shimmerGain.connect(tone); tone.connect(envelope); envelope.connect(this.master); envelope.connect(this.reverb);
    envelope.gain.setValueAtTime(.00001, when); envelope.gain.linearRampToValueAtTime(level, when + .006);
    const decay = Math.max(.25, Math.min(4, 3.3 - midi / 55));
    envelope.gain.exponentialRampToValueAtTime(Math.max(.00002, level * .35), when + .22);
    envelope.gain.exponentialRampToValueAtTime(.00002, when + 1.0 + decay * 3);
    const voice = { midi, envelope, oscillator, shimmer, tone, shimmerGain, when, level, released: false, stopped: false };
    this.voices.add(voice);
    oscillator.onended = () => { voice.stopped = true; this.voices.delete(voice); oscillator.disconnect(); shimmer.disconnect(); tone.disconnect(); envelope.disconnect(); shimmerGain.disconnect(); };
    oscillator.start(when); shimmer.start(when);
    const end = when + Math.max(.025, duration);
    // Scheduled note-offs replace the tail while retaining the decay envelope.
    this._release(voice, end, Math.min(.45, .13 + (108 - midi) * .003));
    return voice;
  }

  _release(voice, when, release = .14) {
    if (!voice || voice.stopped) return;
    const ctx = this.context, start = Math.max(ctx.currentTime, when), param = voice.envelope.gain;
    try {
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(start);
      else { param.cancelScheduledValues(start); param.setValueAtTime(Math.max(.00001, voice.level * Math.exp(-Math.max(0, start - voice.when) * 1.5)), start); }
      param.exponentialRampToValueAtTime(.00001, start + release);
      voice.oscillator.stop(start + release + .015); voice.shimmer.stop(start + release + .015);
      voice.released = true;
      if (when <= ctx.currentTime + .001) this.voices.delete(voice);
    } catch { /* A completed oscillator may already have been removed by the audio thread. */ }
  }

  stop() {
    if (this.context) for (const voice of this.voices) this._release(voice, this.context.currentTime, .03);
    this.liveVoices.clear(); this.playing = false; this.song = null; this.nextIndex = 0;
  }

  /** Call each animation frame with transport position in song seconds. */
  tick(song, time, playing, speed = 1) {
    if (!this.context || this.context.state !== 'running') return;
    if (!playing) { if (this.playing) this.stop(); return; }
    const now = this.context.currentTime;
    const expected = this.lastTime + (now - this.lastContextTime) * this.speed;
    const restart = !this.playing || song !== this.song || speed !== this.speed || Math.abs(time - expected) > .18;
    if (restart) {
      this.stop(); this.song = song; this.playing = true;
      let lo = 0, hi = song.notes.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (song.notes[mid].time < time - .002) lo = mid + 1; else hi = mid; }
      this.nextIndex = lo;
      // Restore held notes when starting in the middle of a phrase.
      for (let i = 0; i < lo; i++) {
        const n = song.notes[i];
        if (n.time + n.duration > time + .025) this._voice(n.midi, n.velocity * Math.exp(-(time - n.time) * .3), now, (n.time + n.duration - time) / speed);
      }
    }
    const horizon = time + .14 * speed;
    while (this.nextIndex < song.notes.length && song.notes[this.nextIndex].time <= horizon) {
      const n = song.notes[this.nextIndex++];
      if (n.time + n.duration > time) this._voice(n.midi, n.velocity, now + Math.max(0, (n.time - time) / speed), Math.max(.025, (n.duration - Math.max(0, time - n.time)) / speed));
    }
    this.speed = speed; this.lastTime = time; this.lastContextTime = now;
  }

  noteOn(midi, velocity = .7, channel = 0) {
    if (!this.context) return;
    this.noteOff(midi, channel);
    const voice = this._voice(midi, velocity, this.context.currentTime, 30);
    if (voice) this.liveVoices.set(`${channel}:${midi}`, voice);
  }

  noteOff(midi, channel = 0) {
    const key = `${channel}:${midi}`, voice = this.liveVoices.get(key);
    if (voice) { this._release(voice, this.context.currentTime, .18); this.liveVoices.delete(key); }
  }

  getStream() {
    if (!this.destination) throw new Error('Enable audio before recording.');
    return this.destination.stream;
  }
}
