const indexes = new WeakMap();
export const EMPTY_NOTES = Object.freeze([]);

/** Query onset-sorted notes that overlap a time window. A maximum-end segment
 * tree skips expired sections without losing earlier, long sustained notes.
 * Song note arrays are immutable after import; replacing or appending notes
 * invalidates the shared index. Preview, export and audio share its storage. */
export class NoteWindowIndex {
  constructor(notes) {
    this.notes = notes;
    this.length = notes.length;
    this.size = 1;
    while (this.size < notes.length) this.size *= 2;
    this.maxEnd = new Float64Array(this.size * 2);
    this.maxEnd.fill(-Infinity);
    for (let i = 0; i < notes.length; i++) this.maxEnd[this.size + i] = notes[i].time + notes[i].duration;
    for (let i = this.size - 1; i > 0; i--) this.maxEnd[i] = Math.max(this.maxEnd[i * 2], this.maxEnd[i * 2 + 1]);
  }

  lowerBound(time) {
    let low = 0, high = this.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.notes[middle].time < time) low = middle + 1; else high = middle;
    }
    return low;
  }

  forEach(from, to, visit, thisArg) {
    let low = 0, high = this.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.notes[middle].time <= to) low = middle + 1; else high = middle;
    }
    if (low) this._visit(1, 0, this.size, low, from, visit, thisArg);
  }

  _visit(node, first, end, last, from, visit, thisArg) {
    if (first >= last || this.maxEnd[node] < from) return;
    if (end - first === 1) { visit.call(thisArg, this.notes[first], first); return; }
    const middle = (first + end) >>> 1;
    this._visit(node * 2, first, middle, last, from, visit, thisArg);
    this._visit(node * 2 + 1, middle, end, last, from, visit, thisArg);
  }
}

export function getNoteIndex(notes = EMPTY_NOTES) {
  let index = indexes.get(notes);
  if (!index || index.length !== notes.length) {
    index = new NoteWindowIndex(notes);
    indexes.set(notes, index);
  }
  return index;
}
