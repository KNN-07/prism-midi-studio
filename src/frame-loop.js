/** One animation callback at a time. A false return parks the loop until invalidated. */
export class FrameLoop {
  constructor(draw, { request = callback => requestAnimationFrame(callback), cancel = handle => cancelAnimationFrame(handle) } = {}) {
    this.draw = draw;
    this.request = request;
    this.cancel = cancel;
    this.pending = null;
    this.lastTime = null;
    this.run = now => {
      this.pending = null;
      const dt = this.lastTime === null ? 0 : Math.min(Math.max(0, (now - this.lastTime) / 1000), .1);
      this.lastTime = now;
      if (this.draw(now, dt)) this.invalidate();
      else if (this.pending === null) this.lastTime = null;
    };
  }

  invalidate() {
    if (this.pending === null) this.pending = this.request(this.run);
  }

  stop() {
    if (this.pending !== null) this.cancel(this.pending);
    this.pending = null;
    this.lastTime = null;
  }

  resetTime() { this.lastTime = null; }
}

/** Fixed-rate work on any refresh-rate display, without catch-up bursts after a stall. */
export class FrameCadence {
  constructor(fps) {
    this.interval = 1000 / fps;
    this.nextTime = null;
  }

  due(now) {
    if (this.nextTime === null) { this.nextTime = now + this.interval; return true; }
    if (now + .1 < this.nextTime) return false;
    this.nextTime += (Math.floor(Math.max(0, now - this.nextTime) / this.interval) + 1) * this.interval;
    return true;
  }
}
