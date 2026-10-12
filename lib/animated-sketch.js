/** Swap the GIF for its still poster whenever its scene is inactive. */
export class AnimatedSketch {
  constructor(root, { title, source, poster, player }, reducedMotion) {
    this.root = root;
    this.source = source;
    this.poster = poster;
    this.reducedMotion = reducedMotion;
    this.active = false;
    root.classList.add('sketch-animation');
    this.image = document.createElement('img');
    this.image.alt = `${title} animated drawing`;
    this.image.width = Math.round(player.width);
    this.image.height = Math.round(player.height);
    this.image.decoding = 'async';
    this.image.draggable = false;
    this.image.src = poster;
    root.append(this.image);
    this.image.addEventListener('error', () => {
      if (this.image.getAttribute('src') === source) this.image.src = poster;
    });
    reducedMotion.addEventListener('change', () => this.update());
  }

  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.update();
  }

  update() {
    const source = this.active && !this.reducedMotion.matches ? this.source : this.poster;
    if (this.image.getAttribute('src') !== source) this.image.src = source;
    this.root.dataset.active = String(this.active);
  }
}
