/** Exact article routes keep unknown hashes out of the detail view. */
export function articleForHash(pages, hash) {
  return pages.find(page => page.hash === hash) || null;
}

function place(element, block) {
  Object.assign(element.style, {
    left: `${block.x}px`, top: `${block.y}px`, width: `${block.width}px`,
    height: `${block.height}px`, zIndex: String(block.order),
  });
  if (block.rotation) element.style.transform = `rotate(${block.rotation}deg)`;
  element.dataset.figmaNode = block.id;
}

/** A full-page modal keeps article scrolling separate from the scroll story. */
export class HighlightDetails {
  constructor(pages, { reducedMotion, onRequestClose, onClose = () => {} }) {
    this.pages = pages;
    this.reducedMotion = reducedMotion;
    this.onRequestClose = onRequestClose;
    this.onClose = onClose;
    this.current = null;
    this.animation = null;
    this.transition = 0;
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'highlight-detail';
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.setAttribute('aria-label', 'Highlights story');
    this.dialog.id = 'highlight-detail';
    const requestClose = () => {
      if (!this.isOpen || this.closing || this.closeRequested) return;
      this.closeRequested = true;
      onRequestClose();
    };
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
    this.scroller = document.createElement('div');
    this.scroller.className = 'detail-scroller';
    this.scroller.tabIndex = 0;
    this.scroller.setAttribute('aria-label', 'Story content. Scroll to read more.');
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'detail-toolbar';
    this.counter = document.createElement('span');
    this.counter.className = 'detail-counter';
    this.counter.setAttribute('aria-hidden', 'true');
    this.back = document.createElement('button');
    this.back.type = 'button';
    this.back.className = 'detail-back';
    this.back.textContent = '← Back to Highlights';
    this.back.setAttribute('aria-label', 'Back to Highlights');
    this.back.title = 'Back to Highlights (Esc)';
    this.back.addEventListener('click', requestClose);
    this.dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      // These articles contain text and images; keep the two interactive stops
      // inside the reader instead of tabbing into browser chrome or the story.
      const stops = [this.scroller, this.back];
      const index = stops.indexOf(document.activeElement);
      const next = (index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
      event.preventDefault();
      stops[next].focus({ preventScroll: true });
    });
    this.toolbar.append(this.counter, this.back);
    this.dialog.append(this.scroller, this.toolbar);
    document.body.append(this.dialog);
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        this.observer.unobserve(entry.target);
      }
    }, { root: this.scroller, threshold: 0.02 });
    reducedMotion.addEventListener('change', () => {
      this.animation?.finish();
      if (reducedMotion.matches) this.scroller.querySelectorAll('.detail-block').forEach(block => block.classList.add('is-revealed'));
    });
  }

  get isOpen() { return this.dialog.open; }

  createPage(page) {
    const article = document.createElement('article');
    article.className = `detail-page detail-page-${page.number}`;
    article.lang = 'en';
    article.dataset.figmaNode = page.id;
    article.style.setProperty('--detail-height', `${page.height}px`);
    const title = document.createElement('h2');
    title.id = `detail-title-${page.number}`;
    title.className = 'sr-only';
    title.textContent = page.title;
    article.setAttribute('aria-labelledby', title.id);
    this.dialog.setAttribute('aria-labelledby', title.id);
    const sheet = document.createElement('div');
    sheet.className = 'detail-sheet';
    sheet.style.width = `${page.width}px`;
    sheet.style.height = `${page.height}px`;
    const masthead = document.createElement('header');
    masthead.className = 'detail-masthead';
    for (const block of [...page.masthead].sort((a, b) => a.x - b.x || a.y - b.y)) {
      const label = document.createElement('span');
      label.textContent = block.text;
      label.className = 'detail-masthead-label';
      label.dataset.label = block.text;
      label.style.fontSize = `${block.fontSize}px`;
      place(label, block);
      masthead.append(label);
    }
    sheet.append(title, masthead);
    this.images = [];
    for (const block of page.blocks) {
      let element;
      if (block.type === 'image') {
        element = document.createElement('img');
        element.alt = block.alt;
        element.draggable = false;
        element.loading = this.images.length === 0 ? 'eager' : 'lazy';
        element.fetchPriority = this.images.length === 0 ? 'high' : 'auto';
        element.width = Math.round(block.width);
        element.height = Math.round(block.height);
        this.setImage(element, block, page);
        this.images.push({ image: element, asset: block });
      } else {
        element = document.createElement(block.role === 'opening' ? 'h3' : 'p');
        element.textContent = block.text;
        element.style.fontSize = `${block.fontSize}px`;
        element.style.textAlign = block.align;
      }
      element.className = `detail-block detail-${block.type}`;
      if (block.role) element.dataset.role = block.role;
      place(element, block);
      if (this.reducedMotion.matches) element.classList.add('is-revealed');
      else this.observer.observe(element);
      sheet.append(element);
    }
    article.append(sheet);
    return article;
  }

  setImage(image, asset, page) {
    image.decoding = 'async';
    image.sizes = `${Math.ceil(innerWidth <= 700 ? innerWidth - 48 : asset.width * innerWidth / page.width)}px`;
    image.srcset = asset.srcset;
    image.src = asset.src;
  }

  resize() {
    if (!this.current) return;
    this.dialog.style.setProperty('--detail-scale', String(this.scroller.clientWidth / this.current.width));
    for (const { image, asset } of this.images) this.setImage(image, asset, this.current);
  }

  open(page, trigger = null) {
    if (this.current === page && !this.closing) return;
    ++this.transition;
    this.animation?.cancel();
    this.closing = false;
    this.closeRequested = false;
    if (!this.isOpen) {
      this.returnFocus = trigger || document.querySelector(`[data-figma-node="${page.characterId}"]`);
      this.originalTitle = document.title;
      document.documentElement.classList.add('detail-open');
      this.dialog.showModal();
    }
    this.current = page;
    this.dialog.dataset.article = page.number;
    this.counter.textContent = `${page.number} / 04`;
    document.title = `${page.title} — GHOST SIGNS`;
    this.observer.disconnect();
    this.scroller.replaceChildren(this.createPage(page));
    this.scroller.scrollTop = 0;
    this.resize();
    this.back.focus({ preventScroll: true });
    if (!this.reducedMotion.matches) this.animation = this.dialog.animate([
      { opacity: 0, transform: 'translateY(28px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
  }

  async close({ restoreFocus = true } = {}) {
    if (!this.isOpen || this.closing) return;
    this.closing = true;
    const transition = ++this.transition;
    this.animation?.cancel();
    if (!this.reducedMotion.matches) {
      this.animation = this.dialog.animate([
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(20px)' },
      ], { duration: 230, easing: 'cubic-bezier(.4,0,1,1)' });
      await this.animation.finished.catch(() => {});
    }
    if (transition !== this.transition) return;
    this.dialog.close();
    document.documentElement.classList.remove('detail-open');
    document.title = this.originalTitle;
    this.current = null;
    this.closing = false;
    this.closeRequested = false;
    this.observer.disconnect();
    this.scroller.replaceChildren();
    this.images = [];
    if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.onClose();
  }
}
