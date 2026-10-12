/** Scroll-scrubbed motion derived from THE LINE's FeaturedWorkAsset component.
 * The title now settles early while the delayed white panel continues to fill
 * the viewport. These are scroll positions, not a time-based animation.
 */
export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const STORY = Object.freeze({ firstEnd: 1, secondHoldEnd: 1.4, end: 5.2 });
export const LAYERED_SCENES = Object.freeze([
  { id: 'highlights', start: 1.4, end: 2.4 },
  { id: 'sketches', start: 2.8, end: 3.8 },
  { id: 'collection', start: 4.2, end: STORY.end },
]);
export const DESTINATIONS = Object.freeze({
  '#home': 0, '#drawings': 1.2,
  ...Object.fromEntries(LAYERED_SCENES.map(scene => [`#${scene.id}`, scene.end])),
});
export const FEATURED = Object.freeze({ duration: 0.5, backgroundDuration: 0.32, delay: 0.06, background: { x: 15, y: 110, rotation: 15 }, content: { x: 20, y: 130, rotation: 15 } });

/** All three panels settle flush with the viewport below a stationary title. */
export function sceneGeometry(width, height) {
  const header = Math.min(height * 0.25, Math.max(92, width * 0.123));
  return { header, panelHeight: height - header, contentScale: Math.min(width / 1440, (height - header) / 900) };
}

export function panelSpread(contentProgress) {
  const progress = clamp((contentProgress - 0.2) / 0.8);
  return 0.84 + 0.16 * (1 - (1 - progress) ** 2);
}

/** Exact critically damped integration: continuous velocity on discrete wheel
 * inputs, identical timing at 60/120/144 Hz, and no target overshoot. */
export function smoothScrollStep(position, target, velocity, elapsedMs) {
  if (position === target || (Math.abs(target - position) < 0.1 && Math.abs(velocity) < 2)) {
    return { position: target, velocity: 0 };
  }
  const seconds = clamp(elapsedMs, 0, 64) / 1000;
  const frequency = 24;
  const offset = position - target;
  const term = (velocity + frequency * offset) * seconds;
  const decay = Math.exp(-frequency * seconds);
  const next = target + (offset + term) * decay;
  if ((target - position) * (next - target) >= 0) return { position: target, velocity: 0 };
  return { position: next, velocity: (velocity - frequency * term) * decay };
}

const SCENE_WINDOWS = [
  { start: -Infinity, end: STORY.firstEnd },
  { start: 0, end: LAYERED_SCENES[0].end },
  ...LAYERED_SCENES.map((scene, index) => ({ start: scene.start, end: LAYERED_SCENES[index + 1]?.end ?? Infinity })),
];

export function preparedScenes(progress, margin = 0.18) {
  return SCENE_WINDOWS.map(scene => progress >= scene.start - margin && progress <= scene.end + margin);
}

export function featuredTracks(progress) {
  const time = clamp(progress) * (FEATURED.duration + FEATURED.delay);
  const back = clamp(time / FEATURED.backgroundDuration);
  const front = clamp((time - FEATURED.delay) / FEATURED.duration);
  const interpolate = (from, p) => ({ x: from.x * (1 - p), y: from.y * (1 - p), rotation: from.rotation * (1 - p) });
  return { background: interpolate(FEATURED.background, back), content: interpolate(FEATURED.content, front), backgroundProgress: back, contentProgress: front };
}

export function getSceneState(scrollInViewports, reducedMotion = false) {
  const first = clamp(scrollInViewports / STORY.firstEnd);
  const layered = LAYERED_SCENES.map(scene => {
    const progress = clamp((scrollInViewports - scene.start) / (scene.end - scene.start));
    return { id: scene.id, progress, tracks: featuredTracks(progress) };
  });
  let active = first < 0.5 ? 0 : 1;
  layered.forEach((scene, i) => { if (scene.progress >= 0.5) active = i + 2; });
  return { first, featured: layered[0].progress, tracks: layered[0].tracks, layered, active, reducedMotion };
}

export function transform({ x = 0, y = 0, rotation = 0 }) {
  return `translate3d(${x}%, ${y}%, 0) rotate(${rotation}deg)`;
}
