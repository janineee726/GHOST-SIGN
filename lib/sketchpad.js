const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Store normalized points so a drawing survives resizing and reopening. */
export class DrawingHistory {
  constructor() { this.strokes = []; this.current = null; }
  begin(point, color, width, referenceSize) {
    this.current = { color, width: clamp(width, 1, 24) / Math.max(1, referenceSize), points: [] };
    this.add(point);
  }
  add({ x, y }) {
    if (this.current && Number.isFinite(x) && Number.isFinite(y)) this.current.points.push({ x: clamp(x, 0, 1), y: clamp(y, 0, 1) });
  }
  finish(cancel = false) {
    if (!cancel && this.current?.points.length) this.strokes.push(this.current);
    this.current = null;
  }
  undo() { this.current = null; this.strokes.pop(); }
  clear() { this.current = null; this.strokes = []; }
}

/** An optional tracing-paper surface over the second scene. */
export class Sketchpad {
  constructor(trigger, { reducedMotion, onOpen, onClose }) {
    this.trigger = trigger;
    this.reducedMotion = reducedMotion;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.history = new DrawingHistory();
    this.pointer = null;
    this.color = '#242424';
    this.width = 5;
    this.frame = 0;
    this.drawn = 0;
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'drawing-board';
    this.dialog.className = 'drawing-dialog';
    this.dialog.setAttribute('aria-label', 'Drawing board');
    this.dialog.innerHTML = `
      <canvas class="drawing-canvas" tabindex="0" aria-label="Drawing surface. Drag with a mouse, pen, or finger to draw."></canvas>
      <button class="drawing-close" type="button" aria-label="Close drawing board"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
      <div class="drawing-tools" role="group" aria-label="Drawing tools">
        <fieldset class="drawing-colors"><legend>Ink</legend><div class="drawing-swatches"></div></fieldset>
        <label class="drawing-custom">Custom<input type="color" value="#242424" aria-label="Custom brush color"></label>
        <label class="drawing-size" for="brush-width">Brush <output for="brush-width">5 px</output><input id="brush-width" type="range" min="1" max="24" step="1" value="5" aria-label="Brush width"></label>
        <div class="drawing-actions"><button class="drawing-undo" type="button" disabled>Undo</button><button class="drawing-clear" type="button" disabled>Clear</button></div>
      </div>`;
    document.body.append(this.dialog);
    this.canvas = this.dialog.querySelector('canvas');
    this.context = this.canvas.getContext('2d');
    this.custom = this.dialog.querySelector('input[type="color"]');
    this.range = this.dialog.querySelector('input[type="range"]');
    this.output = this.dialog.querySelector('output');
    this.undo = this.dialog.querySelector('.drawing-undo');
    this.clear = this.dialog.querySelector('.drawing-clear');
    this.swatches = [];
    for (const [name, color] of [['Charcoal', '#242424'], ['Pink', '#ff328f'], ['Mint', '#5dd6b8'], ['Orange', '#ff9700'], ['Blue', '#4734e4']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'drawing-swatch';
      button.style.setProperty('--swatch', color);
      button.setAttribute('aria-label', `${name} ink`);
      button.setAttribute('aria-pressed', String(color === this.color));
      button.addEventListener('click', () => this.setColor(color));
      this.dialog.querySelector('.drawing-swatches').append(button);
      this.swatches.push({ button, color });
    }
    trigger.addEventListener('click', () => this.open());
    this.dialog.querySelector('.drawing-close').addEventListener('click', () => this.close());
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.custom.addEventListener('input', () => this.setColor(this.custom.value));
    this.range.addEventListener('input', () => {
      this.width = Number(this.range.value);
      this.output.textContent = `${this.width} px`;
    });
    this.undo.addEventListener('click', () => { this.history.undo(); this.redraw(); this.updateTools(); });
    this.clear.addEventListener('click', () => { this.history.clear(); this.redraw(); this.updateTools(); });
    this.canvas.addEventListener('pointerdown', event => this.start(event));
    this.canvas.addEventListener('pointermove', event => this.move(event));
    this.canvas.addEventListener('pointerup', event => this.finish(event));
    this.canvas.addEventListener('pointercancel', event => this.finish(event, true));
    this.canvas.addEventListener('lostpointercapture', event => this.finish(event, true));
    this.dialog.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); this.history.undo(); this.redraw(); this.updateTools();
      }
      if (event.key === 'Tab') {
        const stops = [...this.dialog.querySelectorAll('button:not(:disabled),input,canvas')];
        const index = stops.indexOf(document.activeElement);
        event.preventDefault();
        stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length].focus({ preventScroll: true });
      }
    });
    reducedMotion.addEventListener('change', () => this.animation?.finish());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.finish(null, true); });
  }

  get isOpen() { return this.dialog.open; }

  setColor(color) {
    this.color = color;
    this.custom.value = color;
    for (const swatch of this.swatches) swatch.button.setAttribute('aria-pressed', String(swatch.color === color));
  }

  open() {
    if (this.isOpen) return;
    this.onOpen();
    document.documentElement.classList.add('drawing-open');
    this.dialog.showModal();
    this.trigger.setAttribute('aria-expanded', 'true');
    this.resize();
    this.canvas.focus({ preventScroll: true });
    if (!this.reducedMotion.matches) this.animation = this.dialog.animate([
      { opacity: 0, transform: 'translateY(18px) rotate(-1deg)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });
  }

  async close() {
    if (!this.isOpen || this.closing) return;
    this.closing = true;
    this.finish(null, true);
    this.animation?.cancel();
    if (!this.reducedMotion.matches) {
      this.animation = this.dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180 });
      await this.animation.finished.catch(() => {});
    }
    this.dialog.close();
    this.closing = false;
    document.documentElement.classList.remove('drawing-open');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.focus({ preventScroll: true });
    this.onClose();
  }

  resize() {
    if (!this.isOpen) return;
    this.finish(null);
    this.bounds = this.canvas.getBoundingClientRect();
    const density = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.bounds.width * density);
    this.canvas.height = Math.round(this.bounds.height * density);
    this.context.setTransform(density, 0, 0, density, 0, 0);
    this.redraw();
  }

  point(event) { return { x: (event.clientX - this.bounds.left) / this.bounds.width, y: (event.clientY - this.bounds.top) / this.bounds.height }; }

  start(event) {
    if (!this.isOpen || this.closing || !event.isPrimary || event.button !== 0 || this.pointer !== null) return;
    event.preventDefault();
    // Finish the entrance before reading coordinates so a fast first stroke
    // cannot drift with the moving sheet.
    this.animation?.finish();
    this.canvas.focus({ preventScroll: true });
    this.bounds = this.canvas.getBoundingClientRect();
    this.pointer = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    this.history.begin(this.point(event), this.color, this.width, Math.min(this.bounds.width, this.bounds.height));
    this.drawn = 0;
    this.paintCurrent();
  }

  move(event) {
    if (event.pointerId !== this.pointer) return;
    const points = event.getCoalescedEvents?.();
    for (const point of points?.length ? points : [event]) this.history.add(this.point(point));
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.paintCurrent(); });
  }

  finish(event, cancel = false) {
    if (this.pointer === null || (event && event.pointerId !== this.pointer)) return;
    if (event && !cancel) this.history.add(this.point(event));
    cancelAnimationFrame(this.frame); this.frame = 0;
    this.paintCurrent();
    this.history.finish(cancel);
    const pointer = this.pointer; this.pointer = null;
    if (this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    if (cancel) this.redraw();
    this.updateTools();
  }

  paint(stroke, start = 0) {
    const ctx = this.context, points = stroke.points;
    if (!points.length) return;
    const width = this.bounds.width, height = this.bounds.height;
    ctx.strokeStyle = ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width * Math.min(width, height);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    if (points.length === 1) {
      ctx.arc(points[0].x * width, points[0].y * height, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
    } else {
      const first = Math.max(0, start - 1);
      ctx.moveTo(points[first].x * width, points[first].y * height);
      for (let i = first + 1; i < points.length; i++) ctx.lineTo(points[i].x * width, points[i].y * height);
      ctx.stroke();
    }
  }

  paintCurrent() {
    if (!this.history.current) return;
    this.paint(this.history.current, this.drawn);
    this.drawn = this.history.current.points.length;
  }

  redraw() {
    if (!this.bounds) return;
    this.context.clearRect(0, 0, this.bounds.width, this.bounds.height);
    for (const stroke of this.history.strokes) this.paint(stroke);
    if (this.history.current) this.paint(this.history.current);
  }

  updateTools() {
    this.undo.disabled = this.clear.disabled = this.history.strokes.length === 0;
    this.canvas.dataset.strokeCount = String(this.history.strokes.length);
  }
}
