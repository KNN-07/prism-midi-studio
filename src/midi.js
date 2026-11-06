const MAX_EVENTS = 1000000;
const decoder = new TextDecoder();

/** Parse Standard MIDI Files (format 0/1). No file data leaves the browser. */
export function parseMidi(buffer, filename = 'Untitled performance') {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const need = (n, end = bytes.length) => { if (pos + n > end) throw new Error('This MIDI file is truncated or contains an invalid event.'); };
  const u16 = () => { need(2); const n = view.getUint16(pos); pos += 2; return n; };
  const u32 = () => { need(4); const n = view.getUint32(pos); pos += 4; return n; };
  const tag = () => { need(4); const s = String.fromCharCode(...bytes.subarray(pos, pos + 4)); pos += 4; return s; };
  const vlq = (end) => {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      need(1, end);
      const byte = bytes[pos++]; value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
    throw new Error('This MIDI file has an invalid variable-length value.');
  };
  if (tag() !== 'MThd') throw new Error('Please choose a Standard MIDI (.mid or .midi) file.');
  const headerLength = u32();
  if (headerLength < 6) throw new Error('This MIDI file has an invalid header.');
  need(headerLength);
  const headerEnd = pos + headerLength;
  const format = u16(), trackCount = u16(), ppq = u16();
  if (format > 1) throw new Error('Format 2 MIDI is not supported. Export your performance as MIDI format 0 or 1.');
  if (ppq & 0x8000) throw new Error('SMPTE-timed MIDI is not supported. Export with a musical beat-based time division.');
  if (!ppq || !trackCount || trackCount > 4096 || (format === 0 && trackCount !== 1)) throw new Error('This MIDI file has an invalid time division or track count.');
  pos = headerEnd;
  const events = [], tempoEvents = [], tracks = [];
  let order = 0, maxTick = 0;
  for (let track = 0; track < trackCount; track++) {
    if (tag() !== 'MTrk') throw new Error('A MIDI track is missing or invalid.');
    const length = u32(); need(length);
    const end = pos + length;
    let tick = 0, running = 0;
    tracks.push({ name: `Track ${track + 1}`, count: 0 });
    while (pos < end) {
      if (++order > MAX_EVENTS) throw new Error('This MIDI file is too large (over one million events).');
      tick += vlq(end); maxTick = Math.max(maxTick, tick);
      need(1, end);
      let status = bytes[pos++];
      if (status < 128) {
        if (!running) throw new Error('This MIDI file contains invalid running status.');
        pos--; status = running;
      } else if (status < 0xf0) running = status;
      else running = 0;
      if (status === 0xff) {
        need(1, end);
        const type = bytes[pos++], size = vlq(end); need(size, end);
        if (type === 0x51) {
          if (size !== 3) throw new Error('This MIDI file contains an invalid tempo event.');
          const micros = bytes[pos] * 65536 + bytes[pos + 1] * 256 + bytes[pos + 2];
          if (!micros) throw new Error('This MIDI file contains a zero tempo.');
          tempoEvents.push({ tick, micros, order });
        }
        if (type === 3) tracks[track].name = decoder.decode(bytes.subarray(pos, pos + size)).replace(/[\x00-\x1f]/g, '').trim() || tracks[track].name;
        pos += size;
        if (type === 0x2f) { pos = end; break; }
      } else if (status === 0xf0 || status === 0xf7) {
        const size = vlq(end); need(size, end); pos += size;
      } else if (status < 0xf0) {
        const type = status >> 4, channel = status & 15;
        const size = type === 0xc || type === 0xd ? 1 : 2;
        need(size, end);
        const a = bytes[pos++], b = size === 2 ? bytes[pos++] : 0;
        if (a > 127 || b > 127) throw new Error('This MIDI file contains invalid channel data.');
        if (type === 8 || type === 9 || (type === 11 && (a === 64 || a === 120 || a === 121 || a === 123))) events.push({ tick, type, channel, a, b, track, order });
      } else throw new Error('This MIDI file contains an unsupported system event.');
    }
  }

  tempoEvents.sort((a,b) => a.tick - b.tick || a.order - b.order);
  const tempoMap = [{ tick: 0, micros: 500000, time: 0 }];
  for (const event of tempoEvents) {
    const last = tempoMap.at(-1);
    if (last.tick === event.tick) last.micros = event.micros;
    else tempoMap.push({ tick: event.tick, micros: event.micros, time: last.time + (event.tick - last.tick) * last.micros / ppq / 1e6 });
  }
  // Channel events are processed in tick order. Store each note's start time
  // once, then advance through the tempo map instead of searching it twice
  // for every note (including every note released by the sustain pedal).
  let tempoIndex = 0;
  const seconds = (tick) => {
    while (tempoIndex + 1 < tempoMap.length && tempoMap[tempoIndex + 1].tick <= tick) tempoIndex++;
    const tempo = tempoMap[tempoIndex];
    return tempo.time + (tick - tempo.tick) * tempo.micros / ppq / 1e6;
  };
  const active = new Map(), sustained = Array.from({ length: 16 }, () => []), pedal = Array(16).fill(false), notes = [];
  const finish = (note, tick) => {
    const time = note.time, end = seconds(Math.max(note.tick, tick));
    notes.push({ midi: note.midi, time, duration: Math.max(0.001, end - time), keyDuration: note.keyDuration ?? Math.max(0.001, end - time), velocity: note.velocity, track: note.track, channel: note.channel });
    tracks[note.track].count++;
  };
  const releasePedal = (channel, tick) => { for (const note of sustained[channel]) finish(note, tick); sustained[channel] = []; };
  events.sort((a,b) => a.tick - b.tick || a.order - b.order);
  for (const e of events) {
    const key = e.channel * 128 + e.a;
    if (e.type === 9 && e.b > 0) {
      const note = { midi: e.a, tick: e.tick, time: seconds(e.tick), velocity: e.b / 127, track: e.track, channel: e.channel, next: null };
      const queue = active.get(key);
      if (queue) { queue.tail.next = note; queue.tail = note; }
      else active.set(key, { head: note, tail: note });
    } else if (e.type === 8 || e.type === 9) {
      const queue = active.get(key);
      if (queue) {
        const note = queue.head;
        queue.head = note.next; note.next = null;
        note.keyDuration = Math.max(0.001, seconds(e.tick) - note.time);
        if (pedal[e.channel]) sustained[e.channel].push(note); else finish(note, e.tick);
        if (!queue.head) active.delete(key);
      }
    } else if (e.type === 11) {
      if (e.a === 64) { pedal[e.channel] = e.b >= 64; if (!pedal[e.channel]) releasePedal(e.channel, e.tick); }
      if (e.a === 120 || e.a === 123) {
        for (const [id, queue] of active) if (Math.floor(id / 128) === e.channel) {
          for (let note = queue.head; note; note = note.next) { if (e.a === 123 && pedal[e.channel]) { note.keyDuration = Math.max(0.001, seconds(e.tick) - note.time); sustained[e.channel].push(note); } else finish(note, e.tick); }
          active.delete(id);
        }
        if (e.a === 120) releasePedal(e.channel, e.tick);
      }
      if (e.a === 121) { pedal[e.channel] = false; releasePedal(e.channel, e.tick); }
    }
  }
  for (const queue of active.values()) for (let note = queue.head; note; note = note.next) finish(note, Math.max(maxTick, note.tick + ppq / 4));
  for (let channel = 0; channel < 16; channel++) releasePedal(channel, maxTick);
  notes.sort((a,b) => a.time - b.time || a.midi - b.midi || a.track - b.track);
  if (!notes.length) throw new Error('This MIDI file has no playable notes.');
  const duration = notes.reduce((end, note) => Math.max(end, note.time + note.duration), seconds(maxTick));
  return { name: filename.replace(/\.(mid|midi)$/i, ''), notes, duration, bpm: Math.round(60000000 / tempoMap[0].micros), tracks, tempos: tempoMap.map(t => ({ tick: t.tick, time: t.time, bpm: 60000000 / t.micros })) };
}

/** An original composition, generated locally; safe to include in your videos. */
export function createDemoSong() {
  const bpm = 96, beat = 60 / bpm, notes = [];
  const chords = [[45,52,57,60,64], [41,48,53,57,60], [48,55,60,64,67], [43,50,55,59,62]];
  const melody = [76,74,72,71,69,72,76,79,77,76,72,69,67,71,74,76];
  const add = (midi,time,duration,velocity,track) => notes.push({ midi, time, duration, velocity, track, channel: track });
  for (let bar = 0; bar < 32; bar++) {
    const chord = chords[bar % chords.length], start = bar * 4 * beat;
    add(chord[0] - 12, start, beat * 3.8, .57, 0);
    add(chord[1], start, beat * 3.7, .36, 0);
    for (let i = 0; i < 8; i++) add(chord[[0,1,2,3,4,3,2,1][i]], start + i * beat / 2, beat * 1.05, .40 + (i % 3) * .055, 0);
    for (let i = 0; i < 4; i++) {
      const m = melody[(bar * 3 + i) % melody.length] + (bar >= 16 && bar < 24 ? 12 : 0);
      add(m, start + i * beat, beat * (i === 3 ? 1.25 : .88), .64 + (i % 2) * .10, 1);
      if (bar % 4 === 2 && i > 1) add(m - 12, start + i * beat, beat * .8, .32, 1);
    }
  }
  const end = 128 * beat;
  for (const pitch of [33,45,52,57,60,64,69,76]) add(pitch, end, 3.6, .48, pitch > 64 ? 1 : 0);
  notes.sort((a,b) => a.time - b.time || a.midi - b.midi || a.track - b.track);
  // Releasing repeated keys before their next attack also makes MIDI round-trips unambiguous.
  const previous = new Map();
  for (const note of notes) {
    const key = note.channel * 128 + note.midi, last = previous.get(key);
    if (last) last.duration = Math.max(.03, Math.min(last.duration, note.time - last.time - .015));
    previous.set(key, note);
  }
  return { name: 'First light', notes, duration: end + 4, bpm, tracks: [{ name: 'Arpeggio & bass', count: notes.filter(n => n.track === 0).length }, { name: 'Melody', count: notes.filter(n => n.track === 1).length }], tempos: [{ time: 0, tick: 0, bpm }] };
}

/** Write a format-1 MIDI with a constant tempo, preserving note timing in seconds. */
export function encodeMidi(song) {
  const ppq = 480, bpm = Math.max(20, Math.min(300, song.bpm || 120)), micros = Math.round(60000000 / bpm);
  const toTick = time => Math.max(0, Math.round(time * 1e6 * ppq / micros));
  const variable = n => { const out = [n & 127]; while ((n = Math.floor(n / 128))) out.unshift((n & 127) | 128); return out; };
  const text = str => [...new TextEncoder().encode(str)];
  const uint32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (tag, body) => {
    const data = new Uint8Array(body.length + 8);
    data.set(text(tag)); data.set(uint32(body.length), 4); data.set(body, 8);
    return data;
  };
  // Group once: exporting many tracks must not rescan the complete song for
  // each track. Typed chunks also avoid a second large number-array copy.
  const trackNotes = new Map();
  for (const note of song.notes) {
    const id = note.track || 0;
    if (!trackNotes.has(id)) trackNotes.set(id, []);
    trackNotes.get(id).push(note);
  }
  const trackIds = [...trackNotes.keys()].sort((a,b) => a - b);
  const count = trackIds.length + 1;
  const chunks = [chunk('MThd', [0,1,count >> 8,count & 255,ppq >> 8,ppq & 255]),
    chunk('MTrk', [0,255,81,3,micros >> 16 & 255,micros >> 8 & 255,micros & 255,0,255,47,0])];
  for (const id of trackIds) {
    const name = text(song.tracks?.[id]?.name || `Track ${id + 1}`), body = [0,255,3,...variable(name.length),...name];
    const events = [];
    for (const n of trackNotes.get(id)) {
      const midi = Math.min(127, Math.max(0, Math.round(n.midi))), channel = (n.channel ?? id) % 16;
      const start = toTick(n.time), end = Math.max(start + 1, toTick(n.time + n.duration));
      events.push({ tick: start, on: true, data: [0x90 | channel,midi,Math.max(1, Math.min(127, Math.round(n.velocity * 127)))] });
      events.push({ tick: end, on: false, data: [0x80 | channel,midi,0] });
    }
    events.sort((a,b) => a.tick - b.tick || Number(a.on) - Number(b.on));
    let last = 0;
    for (const event of events) { body.push(...variable(event.tick - last), ...event.data); last = event.tick; }
    body.push(...variable(Math.max(last, toTick(song.duration || 0)) - last),255,47,0);
    chunks.push(chunk('MTrk', body));
  }
  const output = new Uint8Array(chunks.reduce((length, data) => length + data.length, 0));
  let offset = 0;
  for (const data of chunks) { output.set(data, offset); offset += data.length; }
  return output;
}
