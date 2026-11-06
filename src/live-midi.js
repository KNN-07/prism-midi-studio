/** Live note state survives asynchronous audio startup and respects MIDI sustain. */
export class LiveMidi {
  constructor(audio, { onStart = () => true, getTime = () => 0, onChange = () => {}, onError = () => {} } = {}, notes = new Map()) {
    this.audio = audio;
    this.onStart = onStart;
    this.getTime = getTime;
    this.onChange = onChange;
    this.onError = onError;
    this.notes = notes;
    this.held = new Map();
    this.pedals = new Map();
  }

  async noteOn(midi, velocity = .75, channel = 0) {
    if (!this.onStart()) return;
    const key = `${channel}:${midi}`, previous = this.held.get(key);
    if (previous?.started) this.audio.noteOff(midi, channel);
    const token = { midi, channel, down: true, started: false };
    this.held.set(key, token);
    this.notes.set(key, { midi, velocity, channel, track: channel, time: this.getTime(), duration: 36000 });
    this.onChange();
    try {
      await this.audio.unlock();
      // Note-off, replacement, disconnect, blur or transport changes invalidate the token.
      if (this.held.get(key) !== token) return;
      this.audio.noteOn(midi, velocity, channel);
      token.started = true;
    } catch (error) {
      if (this.held.get(key) === token) { this.held.delete(key); this.notes.delete(key); this.onChange(); this.onError(error); }
    }
  }

  noteOff(midi, channel = 0) {
    const key = `${channel}:${midi}`, token = this.held.get(key);
    if (!token) return;
    token.down = false;
    if (!this.pedals.get(channel)) this._release(key, token);
  }

  sustain(channel, value) {
    const down = typeof value === 'boolean' ? value : value >= 64;
    this.pedals.set(channel, down);
    if (!down) for (const [key, token] of this.held) if (token.channel === channel && !token.down) this._release(key, token);
  }

  controlChange(controller, value, channel = 0) {
    if (controller === 64) this.sustain(channel, value);
    else if (controller === 121) this.sustain(channel, false);
    else if (controller === 120 || controller === 123) {
      for (const [key, token] of this.held) if (token.channel === channel) {
        token.down = false;
        if (controller === 120 || !this.pedals.get(channel)) this._release(key, token);
      }
    }
  }

  _release(key, token) {
    this.held.delete(key);
    this.notes.delete(key);
    if (token.started) this.audio.noteOff(token.midi, token.channel);
    this.onChange();
  }

  reset() {
    for (const [key, token] of this.held) this._release(key, token);
    this.held.clear(); this.notes.clear(); this.pedals.clear();
    this.onChange();
  }
}
