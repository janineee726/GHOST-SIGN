import { constrainPosition, localDelta } from './geometry.js';

export class CollageDrag {
  constructor(root, { bounded = false, onDragging = () => {}, announce = () => {}, onActivate = null } = {}) {
    this.root = root;
    this.bounded = bounded;
    this.onDragging = onDragging;
    this.announce = announce;
    this.onActivate = onActivate;
    this.suppressedClick = null;
    this.items = new Map();
    this.top = 10;
    this.active = null;
    this.frame = 0;
    this.pending = null;
    root.addEventListener('pointerdown', event => this.start(event));
    root.addEventListener('pointermove', event => this.move(event));
    root.addEventListener('pointerup', event => this.finish(event));
    root.addEventListener('pointercancel', event => this.finish(event, true));
    root.addEventListener('lostpointercapture', event => this.finish(event));
    root.addEventListener('keydown', event => this.keydown(event));
    root.addEventListener('click', event => {
      const element = event.target.closest('.drag-item');
      if (!element || !this.onActivate || event.detail > 1) return;
      // A pointer-generated click can still follow pointerup after a long drag.
      // Keyboard activation (detail=0) remains available independently.
      if (event.detail !== 0 && this.suppressedClick === element) { this.suppressedClick = null; return; }
      this.onActivate(element);
    });
    root.addEventListener('dblclick', event => {
      const element = event.target.closest('.drag-item');
      if (element) this.resetItem(element);
    });
  }

  register(element, layout) {
    this.items.set(element, { ...layout, x: layout.x, y: layout.y });
    element.style.zIndex = String(this.top++);
  }

  boundary() { return this.bounded ? { width: this.root.clientWidth, height: this.root.clientHeight } : null; }

  raise(element) { element.style.zIndex = String(++this.top); }

  position(element, x, y, bounds = this.boundary()) {
    const item = this.items.get(element);
    const position = constrainPosition(x, y, item, bounds);
    item.x = position.x;
    item.y = position.y;
    element.style.setProperty('--drag-x', `${item.x - item.initialX}px`);
    element.style.setProperty('--drag-y', `${item.y - item.initialY}px`);
  }

  start(event) {
    const element = event.target.closest('.drag-item');
    if (!element || this.active || event.button !== 0 || !event.isPrimary) return;
    this.suppressedClick = null;
    event.preventDefault();
    element.focus({ preventScroll: true });
    const item = this.items.get(element);
    let matrix = new DOMMatrix();
    // Include BOTH the scroll animation and the artboard's responsive scale.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const cssTransform = getComputedStyle(parent).transform;
      if (cssTransform !== 'none') matrix = new DOMMatrix(cssTransform).multiply(matrix);
    }
    this.active = { element, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: item.x, y: item.y, matrix, bounds: this.boundary(), moved: false };
    this.raise(element);
    element.classList.add('is-dragging');
    element.setPointerCapture(event.pointerId);
    this.onDragging(true);
  }

  move(event) {
    const active = this.active;
    if (!active || active.pointerId !== event.pointerId) return;
    if (this.onActivate && !active.moved) {
      if (Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY) <= 6) return;
      active.moved = true;
    }
    const delta = localDelta(event.clientX - active.clientX, event.clientY - active.clientY, active.matrix);
    this.pending = { x: active.x + delta.x, y: active.y + delta.y };
    if (!this.frame) this.frame = requestAnimationFrame(() => this.flush());
  }

  flush() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.active && this.pending) {
      this.position(this.active.element, this.pending.x, this.pending.y, this.active.bounds);
    }
    this.pending = null;
  }

  finish(event, cancel = false) {
    const active = this.active;
    if (!active || (event && active.pointerId !== event.pointerId)) return;
    const moved = active.moved || (event && Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY) > 6);
    if (this.onActivate && (cancel || moved)) this.suppressedClick = active.element;
    if (cancel) this.pending = null;
    this.flush();
    this.active = null;
    if (cancel) this.position(active.element, active.x, active.y, active.bounds);
    active.element.classList.remove('is-dragging');
    if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    this.onDragging(false);
  }

  keydown(event) {
    const element = event.target.closest('.drag-item');
    if (!element) return;
    if (event.key === 'Escape') { this.finish(null, true); return; }
    if (event.key === 'Home') { event.preventDefault(); this.resetItem(element); return; }
    const step = event.shiftKey ? 50 : 10;
    const directions = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = directions[event.key];
    if (!delta) return;
    event.preventDefault();
    this.raise(element);
    const item = this.items.get(element);
    this.position(element, item.x + delta[0], item.y + delta[1]);
  }

  resetItem(element) {
    if (this.active?.element === element) this.finish(null);
    const item = this.items.get(element);
    this.position(element, item.initialX, item.initialY);
    this.announce('Object returned to its original position.');
  }

  reset() { for (const element of this.items.keys()) this.resetItem(element); }
}
