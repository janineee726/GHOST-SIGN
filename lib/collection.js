import { configureImage } from './images.js';

/** Keep the target stable while lettering moves to the supplied hover layout. */
export function collectionHitArea(item, states) {
  let { x, y, width, height } = item.hitArea;
  let right = x + width, bottom = y + height;
  for (const state of states) {
    const row = state.rows.find(row => row.label === item.label);
    x = Math.min(x, row.x);
    y = Math.min(y, row.hitY);
    right = Math.max(right, row.x + item.width);
    bottom = Math.max(bottom, row.hitY + row.hitHeight);
  }
  return { x, y, width: right - x, height: bottom - y };
}

/** Bounded motion keeps the collage in its Figma composition at pointer rest. */
export function collectionPointerOffset(dx, dy, scale = 1) {
  const safeScale = Math.max(0.01, scale);
  return {
    x: Math.max(-30, Math.min(30, dx / safeScale * 0.2)),
    y: Math.max(-14, Math.min(14, dy / safeScale * 0.2)),
  };
}

function place(element, box) {
  Object.assign(element.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
}

export class CollectionHover {
  constructor(board, items, states, design, reducedMotion) {
    this.board = board;
    this.design = design;
    this.reducedMotion = reducedMotion;
    this.states = new Map(states.map(state => [state.label, state]));
    this.rows = new Map();
    this.panels = new Map();
    this.assets = [];
    this.defaults = [];
    this.active = this.prepared = false;
    this.current = this.hovered = this.focused = this.touched = null;
    this.frame = this.scrambleTimer = 0;
    this.offset = this.target = { x: 0, y: 0 };
    board.classList.add('collection-board');
    const list = document.createElement('ul');
    list.className = 'collection-list';
    list.setAttribute('aria-label', 'The Collection sign directory');
    board.append(list);

    items.forEach((item, index) => {
      if (item.type === 'image') {
        const image = document.createElement('img');
        image.className = 'source-art collection-default';
        image.alt = '';
        image.draggable = false;
        image.dataset.figmaNode = item.id;
        place(image, item);
        image.style.zIndex = String(index + 1);
        configureImage(image, item, design);
        board.append(image);
        this.defaults.push(image);
        return;
      }
      const hit = collectionHitArea(item, states);
      const row = document.createElement('li');
      row.className = 'collection-item';
      row.dataset.label = item.label;
      row.dataset.figmaNode = item.id;
      place(row, hit);
      const button = document.createElement('button');
      button.className = 'collection-trigger';
      button.type = 'button';
      button.setAttribute('aria-label', `Preview ${item.label}`);
      button.setAttribute('aria-describedby', `collection-address-${index}`);
      const description = document.createElement('span');
      description.id = `collection-address-${index}`;
      description.className = 'sr-only';
      description.textContent = this.states.get(item.label).address;
      const label = document.createElement('span');
      label.className = 'collection-label';
      label.setAttribute('aria-hidden', 'true');
      label.style.width = `${item.width}px`;
      label.style.height = `${item.height}px`;
      const lettering = document.createElement('span');
      lettering.className = 'collection-lettering';
      lettering.style.setProperty('--lettering', `url("${item.src}")`);
      const scramble = document.createElement('span');
      scramble.className = 'collection-scramble';
      const symbols = [...'▣❙◈❚❊✺'];
      for (const [i, char] of [...item.label].entries()) {
        const glyph = document.createElement('span');
        glyph.textContent = char === ' ' ? '\u00a0' : symbols[(i + index) % symbols.length];
        scramble.append(glyph);
      }
      label.append(lettering, scramble);
      button.append(label, description);
      row.append(button);
      list.append(row);
      this.rows.set(item.label, { element: row, button, label, hit, item, order: index + 1 });
      row.addEventListener('pointerenter', event => {
        if (!this.active || event.pointerType === 'touch') return;
        this.hovered = item.label;
        this.anchor = { x: event.clientX, y: event.clientY };
        this.pointerScale = board.getBoundingClientRect().width / design.board.width;
        this.show(item.label);
      });
      row.addEventListener('pointermove', event => this.move(event, item.label));
      row.addEventListener('pointerleave', event => {
        if (event.pointerType === 'touch') return;
        this.hovered = null;
        this.show(this.focused || this.touched);
      });
      button.addEventListener('focus', () => {
        if (!this.active || !button.matches(':focus-visible')) return;
        this.focused = item.label;
        this.show(item.label);
      });
      button.addEventListener('blur', () => {
        if (this.focused === item.label) this.focused = null;
        this.show(this.hovered || this.touched);
      });
      button.addEventListener('pointerdown', event => { this.pointerType = event.pointerType; });
      button.addEventListener('click', event => {
        if (!this.active) return;
        if (this.pointerType === 'touch' && event.detail !== 0) {
          this.touched = this.touched === item.label ? null : item.label;
          this.focused = null;
          this.show(this.touched);
        } else if (event.detail === 0) {
          this.focused = item.label;
          this.show(item.label);
        }
      });
    });

    for (const state of states) {
      const panel = document.createElement('div');
      panel.className = 'collection-preview';
      panel.dataset.hoverNode = state.id;
      panel.setAttribute('aria-hidden', 'true');
      for (const asset of state.images) {
        const image = document.createElement('img');
        image.className = `collection-art collection-${asset.kind}`;
        image.alt = '';
        image.draggable = false;
        image.dataset.figmaNode = asset.id;
        place(image, asset);
        image.style.zIndex = String(asset.order);
        panel.append(image);
        this.assets.push({ image, asset });
      }
      this.panels.set(state.label, panel);
      board.append(panel);
    }
    this.paintRows(null);
    document.addEventListener('pointerdown', event => {
      if (!this.active || event.target.closest('.collection-trigger')) return;
      this.touched = this.focused = null;
      this.show(null);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.active) this.clear();
    });
    reducedMotion.addEventListener('change', () => this.resetMotion());
  }

  prepare() {
    if (this.prepared) return;
    this.prepared = true;
    for (const { image, asset } of this.assets) configureImage(image, asset, this.design);
  }

  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    if (!active) this.clear();
  }

  paintRows(state) {
    for (const [name, row] of this.rows) {
      const placement = state?.rows.find(item => item.label === name) || row.item;
      row.label.style.left = `${placement.x - row.hit.x}px`;
      row.label.style.top = `${placement.y - row.hit.y}px`;
      row.element.style.zIndex = String(state ? placement.order : row.order);
      row.element.classList.toggle('is-highlighted', state?.label === name);
    }
  }

  show(name) {
    if (!this.active) name = null;
    if (this.current === name) return;
    const previous = this.current;
    this.current = name;
    this.resetMotion();
    clearTimeout(this.scrambleTimer);
    for (const row of this.rows.values()) row.element.classList.remove('is-scrambling');
    if (previous) this.panels.get(previous).classList.remove('is-active');
    this.board.classList.toggle('has-preview', Boolean(name));
    this.board.dataset.hoverNode = name ? this.states.get(name).id : '';
    this.paintRows(name ? this.states.get(name) : null);
    if (!name) return;
    this.prepare();
    this.panels.get(name).classList.add('is-active');
    if (!this.reducedMotion.matches) {
      const row = this.rows.get(name).element;
      row.classList.add('is-scrambling');
      this.scrambleTimer = setTimeout(() => row.classList.remove('is-scrambling'), 240);
    }
  }

  move(event, name) {
    if (!this.active || event.pointerType === 'touch' || this.current !== name || !this.anchor || this.reducedMotion.matches) return;
    this.target = collectionPointerOffset(event.clientX - this.anchor.x, event.clientY - this.anchor.y, this.pointerScale);
    if (!this.frame) {
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame(time => this.tick(time));
    }
  }

  tick(time) {
    this.frame = 0;
    const alpha = 1 - Math.exp(-Math.min(64, time - this.lastTime) / 75);
    this.lastTime = time;
    this.offset = {
      x: this.offset.x + (this.target.x - this.offset.x) * alpha,
      y: this.offset.y + (this.target.y - this.offset.y) * alpha,
    };
    const pending = Math.hypot(this.target.x - this.offset.x, this.target.y - this.offset.y) > 0.02;
    if (!pending) this.offset = this.target;
    this.board.style.setProperty('--hover-x', `${this.offset.x.toFixed(3)}px`);
    this.board.style.setProperty('--hover-y', `${this.offset.y.toFixed(3)}px`);
    if (pending) this.frame = requestAnimationFrame(next => this.tick(next));
  }

  resetMotion() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.offset = this.target = { x: 0, y: 0 };
    this.board.style.setProperty('--hover-x', '0px');
    this.board.style.setProperty('--hover-y', '0px');
  }

  clear() {
    this.hovered = this.focused = this.touched = null;
    this.anchor = null;
    this.show(null);
    this.resetMotion();
  }
}
