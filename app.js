import { layout } from './assets/layout.js';
import { STORY, DESTINATIONS, clamp, getSceneState, transform, smoothScrollStep, preparedScenes, sceneGeometry, panelSpread } from './lib/motion.js';
import { CollageDrag } from './lib/drag.js';
import { AnimatedSketch } from './lib/animated-sketch.js';
import { configureImage, resizeImages, prepareImages } from './lib/images.js';
import { collectionHovers } from './assets/collection/hover-layout.js';
import { CollectionHover } from './lib/collection.js';
import { highlightDetails } from './assets/highlights/details-layout.js';
import { HighlightDetails, articleForHash } from './lib/details.js';
import { Sketchpad } from './lib/sketchpad.js';

// The absolute-positioned scenes share one scroll track. Native history
// restoration would otherwise override an explicit #home / #highlights on reload.
history.scrollRestoration = 'manual';

const $ = selector => document.querySelector(selector);
const stage = $('.stage');
const screens = [$('.hero'), $('.interlude'), $('.featured')];
const heroSheet = $('.hero-sheet');
const interludeSheet = $('.interlude-sheet');
const menu = $('#navigation');
const menuToggle = $('#menu-toggle');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const HERO_DESIGN = { width: 1440, height: 900, fit: 'width' };
const FEATURED_DESIGN = { width: 1440, height: 900, fit: 'panel' };
// Keep the large shared illustration anchored to the top of each mint scene.
const backgroundScene = layout.sections.find(scene => scene.id === 'sketches');
const BACKGROUND_DESIGN = { width: backgroundScene.width, height: backgroundScene.height, fit: 'cover' };
const scrollCue = $('.scroll-cue');
let viewportHeight = innerHeight;
let dragging = false;
let currentScroll = scrollY;
let frame = 0;
let previousTime = 0;
let scrollVelocity = 0;
let resizeFrame = 0;
let activeScene = -1;

function announce(message) { $('#interaction-status').textContent = message; }
function preventDragScroll(event) { event.preventDefault(); }
function setDragging(value) {
  if (dragging === value) return;
  dragging = value;
  document.body.classList.toggle('is-dragging', value);
  if (value) {
    cancelAnimationFrame(frame);
    frame = previousTime = scrollVelocity = 0;
    // Only a live drag needs scroll cancellation. Normal scrolling stays on
    // the browser's fast path without waiting for a blocking wheel listener.
    window.addEventListener('wheel', preventDragScroll, { passive: false });
  } else {
    window.removeEventListener('wheel', preventDragScroll);
    requestTick();
  }
}
const heroDrag = new CollageDrag($('#hero-objects'), { onDragging: setDragging, announce });
const boardDrag = new CollageDrag($('#white-board'), { bounded: true, onDragging: setDragging, announce, onActivate: element => openArticle(element) });

function position(element, item) {
  Object.assign(element.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` });
  element.style.setProperty('--asset-width', `${item.width}px`);
  element.style.setProperty('--asset-height', `${item.height}px`);
  element.dataset.figmaNode = item.sourceNodeId || item.id;
  if (item.sourcePart) element.dataset.sourcePart = item.sourcePart;
}

function image(item, design = HERO_DESIGN) {
  const element = document.createElement('img');
  element.alt = '';
  element.draggable = false;
  element.width = Math.ceil(item.width);
  element.height = Math.ceil(item.height);
  configureImage(element, item, design);
  return element;
}

function fixedArt(item, parent, design) {
  const element = image(item, design);
  element.className = 'source-art';
  position(element, item);
  parent.append(element);
  return element;
}

function sceneBackground(artboard) {
  const { width, height } = BACKGROUND_DESIGN;
  artboard.classList.add('background-artboard');
  artboard.dataset.designWidth = String(width);
  artboard.dataset.designHeight = String(height);
  Object.assign(artboard.style, { width: `${width}px`, height: `${height}px` });
  fixedArt(backgroundScene.background, artboard, BACKGROUND_DESIGN);
}

function draggableArt(item, controller, design) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'drag-item';
  element.setAttribute('aria-label', `Drag ${item.label}`);
  element.setAttribute('aria-describedby', 'drag-help');
  element.title = `${item.label} · Drag to move, double-click to reset`;
  const article = highlightDetails.find(page => page.characterId === item.id || page.numberId === item.id);
  if (article) {
    element.dataset.detailNumber = article.number;
    element.setAttribute('aria-label', `${item.label}, open story ${article.number}`);
    element.setAttribute('aria-haspopup', 'dialog');
    element.setAttribute('aria-controls', 'highlight-detail');
    element.title = `${article.number} · ${article.title} · Click to read, drag to move, Home to reset`;
  }
  position(element, item);
  element.append(image(item, design));
  controller.root.append(element);
  controller.register(element, { initialX: item.x, initialY: item.y, x: item.x, y: item.y, width: item.width, height: item.height });
}

for (const item of layout.hero) {
  if (item.draggable) draggableArt(item, heroDrag);
  else fixedArt(item, $('#hero-fixed'));
}
for (const item of layout.featured) draggableArt(item, boardDrag, FEATURED_DESIGN);
sceneBackground($('#featured-background-artboard'));
fixedArt({ ...layout.title, x: 0, y: 0 }, $('#featured-title'), FEATURED_DESIGN);
const sceneHeadings = [{ element: $('#featured-title'), heading: layout.title, width: 1601 }];

const players = new Map();
const collections = new Map();
for (const scene of layout.sections) {
  const screen = document.createElement('section');
  screen.className = 'screen content-scene layered-scene';
  screen.id = scene.id;
  screen.dataset.figmaNode = scene.nodeId;
  screen.style.zIndex = String(screens.length + 1);
  screen.inert = true;
  screen.setAttribute('aria-hidden', 'true');
  screen.setAttribute('aria-labelledby', `${scene.id}-title`);

  const artboards = {};
  for (const role of ['background', 'content']) {
    const layer = document.createElement('div');
    layer.className = `scene-${role} motion-layer`;
    const artboard = document.createElement('div');
    const width = role === 'content' ? scene.board.width : scene.width;
    const height = role === 'content' ? scene.board.height : scene.height;
    artboard.className = `artboard ${role === 'content' ? 'panel-artboard' : 'content-artboard'}`;
    artboard.dataset.designWidth = String(width);
    artboard.dataset.designHeight = String(height);
    artboard.style.width = `${width}px`;
    artboard.style.height = `${height}px`;
    if (role === 'content') {
      const panel = document.createElement('div');
      panel.className = 'scene-panel';
      panel.append(artboard);
      layer.append(panel);
    } else layer.append(artboard);
    screen.append(layer);
    artboards[role] = artboard;
  }
  const heading = document.createElement('h2');
  heading.id = `${scene.id}-title`;
  heading.className = 'sr-only';
  heading.textContent = scene.title;
  artboards.background.append(heading);
  sceneBackground(artboards.background);
  const titleArt = document.createElement('div');
  titleArt.className = 'scene-heading';
  titleArt.setAttribute('aria-hidden', 'true');
  artboards.background.parentElement.append(titleArt);
  fixedArt({ ...scene.heading, x: 0, y: 0 }, titleArt, scene);
  sceneHeadings.push({ element: titleArt, heading: scene.heading, width: scene.width });

  const board = document.createElement('div');
  board.className = 'content-board';
  position(board, { ...scene.board, x: 0, y: 0 });
  artboards.content.append(board);
  if (scene.type === 'gif') {
    const player = document.createElement('div');
    position(player, { ...scene.player, x: scene.player.x - scene.board.x, y: scene.player.y - scene.board.y });
    artboards.content.append(player);
    players.set(scene.id, new AnimatedSketch(player, scene, reducedMotion));
  } else if (scene.type === 'collection') {
    collections.set(scene.id, new CollectionHover(board, scene.content, collectionHovers, { ...scene, ...FEATURED_DESIGN }, reducedMotion));
    const back = document.createElement('a');
    back.className = 'scroll-cue back-to-top';
    back.href = '#home';
    back.setAttribute('aria-label', 'Back to top');
    back.innerHTML = '<svg viewBox="0 0 32 44" aria-hidden="true"><path d="M16 41V9M5 20 16 8l11 12" /></svg><span>Back to top</span>';
    screen.querySelector('.scene-panel').append(back);
  }
  stage.append(screen);
  screens.push(screen);
}
const details = new HighlightDetails(highlightDetails, { reducedMotion, onRequestClose: closeArticle, onClose: requestTick });
const sketchpad = new Sketchpad($('#draw-launcher'), { reducedMotion, onOpen: freezeStory, onClose: requestTick });
const layeredScenes = screens.slice(2).map(element => ({
  element,
  background: element.querySelector('.scene-background'),
  content: element.querySelector('.scene-content'),
  panel: element.querySelector('.scene-panel'),
}));
const artboards = [...document.querySelectorAll('.artboard')];
const prepared = [];
const styleCache = new WeakMap();
function setStyle(element, property, value) {
  let previous = styleCache.get(element);
  if (!previous) { previous = {}; styleCache.set(element, previous); }
  if (previous[property] === value) return;
  previous[property] = value;
  element.style[property] = value;
}
function setData(element, property, value) {
  if (element.dataset[property] !== value) element.dataset[property] = value;
}
for (const element of document.querySelectorAll('img[data-responsive]')) {
  const board = element.closest('.artboard');
  configureImage(element, { src: element.getAttribute('src'), srcset: element.getAttribute('srcset'), width: element.width },
    { width: Number(board.dataset.designWidth), height: Number(board.dataset.designHeight), fit: board.dataset.fit || (board.closest('.scene-background') ? 'cover' : undefined) });
}
document.documentElement.style.setProperty('--story-distance', String(STORY.end));

function resize() {
  // A stable layout viewport avoids retiming the story as mobile browser bars move.
  const previousHeight = viewportHeight;
  const visibleProgress = previousHeight ? currentScroll / previousHeight : 0;
  viewportHeight = document.documentElement.clientHeight || innerHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const geometry = sceneGeometry(viewportWidth, viewportHeight);
  document.documentElement.style.setProperty('--viewport-height', `${viewportHeight}px`);
  document.documentElement.style.setProperty('--scene-header', `${geometry.header}px`);
  resizeImages(viewportWidth, viewportHeight);
  for (const artboard of artboards) {
    const widthScale = viewportWidth / Number(artboard.dataset.designWidth);
    const scale = artboard.classList.contains('hero-artboard') ? widthScale
      : artboard.classList.contains('panel-artboard') ? geometry.contentScale
      : Math.max(widthScale, viewportHeight / Number(artboard.dataset.designHeight));
    artboard.style.setProperty('--art-scale', String(scale));
  }
  for (const { element, heading, width } of sceneHeadings) {
    const padding = Math.max(24, Math.min(64, viewportWidth * 0.04));
    const scale = Math.min((viewportWidth - padding * 2) / heading.width,
      Math.max(viewportWidth / width, 32 / heading.height), (geometry.header - 28) / heading.height);
    Object.assign(element.style, { left: `${padding}px`, top: `${(geometry.header - heading.height * scale) / 2}px`,
      width: `${heading.width}px`, height: `${heading.height}px`, transform: `scale(${scale})` });
  }
  heroDrag.finish(null, true);
  boardDrag.finish(null, true);
  collections.forEach(collection => collection.clear());
  details.resize();
  sketchpad.resize();
  // Preserve the scroll chapter during a resize or an orientation change.
  // The browser may already have clamped scrollY to the new document height.
  // Preserve the rendered progress saved BEFORE the resize, not that clamped value.
  if (previousHeight && previousHeight !== viewportHeight) window.scrollTo({ top: visibleProgress * viewportHeight, behavior: 'instant' });
  currentScroll = scrollY;
  scrollVelocity = previousTime = 0;
  render();
}

function render() {
  const progress = currentScroll / viewportHeight;
  const state = getSceneState(progress, reducedMotion.matches);
  const { first, featured, layered, active } = state;
  setData(stage, 'scrollProgress', progress.toFixed(4));
  if (scrollCue.hidden !== (first > 0.2)) scrollCue.hidden = first > 0.2;
  const near = preparedScenes(progress);
  screens.forEach((screen, i) => {
    const warm = reducedMotion.matches ? i === active : near[i];
    if (warm === prepared[i]) return;
    prepared[i] = warm;
    screen.classList.toggle('is-prepared', warm);
    if (warm) {
      collections.get(screen.id)?.prepare();
      prepareImages(screen);
    }
  });
  layeredScenes.forEach((scene, i) => {
    const entry = layered[i];
    const nextProgress = layered[i + 1]?.progress || 0;
    const exit = 1 - (1 - nextProgress) ** 2;
    setData(scene.background, 'progress', entry.tracks.backgroundProgress.toFixed(4));
    setData(scene.content, 'progress', entry.tracks.contentProgress.toFixed(4));
    setStyle(scene.element, 'transform', reducedMotion.matches ? 'none' : transform({ x: -10 * exit, y: 5 * exit, rotation: -4 * exit }));
    setStyle(scene.background, 'transform', reducedMotion.matches ? 'none' : transform(entry.tracks.background));
    setStyle(scene.content, 'transform', reducedMotion.matches ? 'none' : transform(entry.tracks.content));
    setStyle(scene.panel, 'transform', `scaleX(${reducedMotion.matches ? 1 : panelSpread(entry.tracks.contentProgress)})`);
    if (!reducedMotion.matches) setStyle(scene.element, 'visibility', entry.progress > 0 && nextProgress < 1 ? 'visible' : 'hidden');
    // Use the SAME chapter ownership as inert/aria-hidden below. A visible,
    // interactive play button must work even if the user stops mid-entrance.
    players.get(entry.id)?.setActive(active === i + 2 && !document.hidden);
    collections.get(entry.id)?.setActive(active === i + 2 && !document.hidden);
  });

  if (reducedMotion.matches) {
    [heroSheet, interludeSheet].forEach(element => setStyle(element, 'transform', 'none'));
    screens.forEach((screen, i) => setStyle(screen, 'visibility', i === active ? 'visible' : 'hidden'));
  } else {
    setStyle(screens[0], 'visibility', first < 1 ? 'visible' : 'hidden');
    setStyle(screens[1], 'visibility', first > 0 && featured < 1 ? 'visible' : 'hidden');
    const exit = first * first;
    setStyle(heroSheet, 'transform', transform({ x: -10 * exit, rotation: -15 * exit }));
    // The second screen stays a SINGLE sheet: no individual illustration animation.
    const introEnter = clamp(first * 2);
    const introExit = 1 - (1 - featured) ** 2;
    setStyle(interludeSheet, 'transformOrigin', featured > 0 ? 'right center' : 'left center');
    setStyle(interludeSheet, 'transform', transform({ x: -10 * (1 - introEnter) - 10 * introExit, y: 100 * (1 - first) + 5 * introExit, rotation: 8 * (1 - introEnter) - 4 * introExit }));
  }
  if (active !== activeScene) {
    activeScene = active;
    setData(stage, 'activeScene', String(active + 1));
    screens.forEach((screen, i) => {
      screen.inert = i !== active;
      screen.setAttribute('aria-hidden', String(i !== active));
    });
  }
}

function tick(time) {
  frame = 0;
  if (dragging || details.isOpen || sketchpad.isOpen) return;
  const target = clamp(scrollY, 0, STORY.end * viewportHeight);
  const dt = Math.max(0, time - previousTime);
  previousTime = time;
  const next = reducedMotion.matches ? { position: target, velocity: 0 } : smoothScrollStep(currentScroll, target, scrollVelocity, dt);
  currentScroll = next.position;
  scrollVelocity = next.velocity;
  render();
  if (currentScroll !== target) requestTick();
  else previousTime = 0;
}

function requestTick() {
  if (frame || dragging || document.hidden || details.isOpen || sketchpad.isOpen) return;
  if (!previousTime) previousTime = performance.now();
  frame = requestAnimationFrame(tick);
}

function closeMenu(restoreFocus = false) {
  menu.hidden = true;
  menuToggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus && activeScene === 0) menuToggle.focus({ preventScroll: true });
}

function navigate(hash, behavior = 'smooth') {
  const article = articleForHash(highlightDetails, hash);
  if (article) {
    closeMenu();
    if (!details.isOpen && activeScene !== 2) navigate('#highlights', 'instant');
    details.open(article);
    return;
  }
  if (!(hash in DESTINATIONS)) return;
  if (details.isOpen) details.close({ restoreFocus: hash === '#highlights' });
  closeMenu();
  const returnProgress = hash === '#highlights' ? history.state?.highlightReturn : null;
  const motion = reducedMotion.matches || Number.isFinite(returnProgress) ? 'instant' : behavior;
  // Native scroll positions round to CSS pixels; land past the entrance endpoint
  // so fractional viewport heights cannot leave video controls just short of ready.
  const top = Number.isFinite(returnProgress) ? Math.round(returnProgress * viewportHeight) : Math.ceil(DESTINATIONS[hash] * viewportHeight);
  window.scrollTo({ top, behavior: motion });
  if (motion === 'instant') { currentScroll = scrollY; scrollVelocity = previousTime = 0; render(); }
}

function openArticle(element) {
  const article = highlightDetails.find(page => page.number === element.dataset.detailNumber);
  if (!article || activeScene !== 2 || details.isOpen) return;
  closeMenu();
  // Scrolling does not rewrite chapter hashes. Establish a truthful parent entry
  // so browser Back returns to the third screen, even if its URL still said home.
  freezeStory();
  history.replaceState({ highlightReturn: currentScroll / viewportHeight }, '', '#highlights');
  history.pushState({ highlightDetail: true }, '', article.hash);
  details.open(article, element);
}

function freezeStory() {
  cancelAnimationFrame(frame);
  frame = previousTime = scrollVelocity = 0;
  window.scrollTo({ top: currentScroll, behavior: 'instant' });
  currentScroll = scrollY;
  render();
}

function closeArticle() {
  if (!details.isOpen || details.closing) return;
  if (history.state?.highlightDetail) history.back();
  else {
    history.replaceState(null, '', '#highlights');
    navigate('#highlights', 'instant');
  }
}

menuToggle.addEventListener('click', () => {
  const open = menu.hidden;
  menu.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('a').focus();
});
$('#reset-collage').addEventListener('click', () => { heroDrag.reset(); boardDrag.reset(); announce('All objects have returned to their original positions.'); });
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (link) {
    event.preventDefault();
    history.pushState(null, '', link.getAttribute('href'));
    navigate(link.getAttribute('href'));
  } else if (!menu.hidden && !menu.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(true); });
window.addEventListener('scroll', () => { requestTick(); }, { passive: true });
window.addEventListener('resize', () => {
  if (!resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; resize(); });
});
window.addEventListener('hashchange', () => navigate(location.hash));
window.addEventListener('popstate', () => navigate(location.hash || '#home'));
window.addEventListener('blur', () => { heroDrag.finish(null, true); boardDrag.finish(null, true); });
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(frame);
  frame = previousTime = scrollVelocity = 0;
  if (document.hidden) {
    players.forEach(player => player.setActive(false));
    collections.forEach(collection => collection.setActive(false));
  }
  else { currentScroll = scrollY; render(); }
});
reducedMotion.addEventListener('change', () => { currentScroll = scrollY; scrollVelocity = 0; render(); });
resize();
navigate(location.hash || '#home', 'instant');
requestTick();
