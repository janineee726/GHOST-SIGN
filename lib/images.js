import { sceneGeometry } from './motion.js';

// The CSS artboards scale as a unit. Supply their actual on-screen image widths
// to srcset, otherwise the browser chooses textures for the unscaled design.
const responsiveImages = new Map();

function sizeFor(asset, design, width, height) {
  const scale = design.fit === 'width' ? width / design.width : design.fit === 'cover'
    ? Math.max(width / design.width, height / design.height)
    : design.fit === 'panel' ? sceneGeometry(width, height).contentScale
    : Math.min(width / design.width, height / design.height);
  return `${Math.max(1, Math.ceil(asset.width * scale))}px`;
}

export function configureImage(image, asset, design) {
  image.decoding = 'async';
  image.fetchPriority = design.fit === 'width' ? 'high' : 'low';
  if (asset.srcset) {
    responsiveImages.set(image, { asset, design });
    image.sizes = sizeFor(asset, design, document.documentElement.clientWidth, document.documentElement.clientHeight);
    image.srcset = asset.srcset;
  }
  image.src = asset.src;
}

export function resizeImages(width, height) {
  for (const [image, { asset, design }] of responsiveImages) {
    const sizes = sizeFor(asset, design, width, height);
    if (image.sizes !== sizes) image.sizes = sizes;
  }
}

export function prepareImages(screen) {
  for (const image of screen.querySelectorAll('img')) {
    image.fetchPriority = 'high';
    // Decode before the scene enters. A failed asset must not block scrolling.
    image.decode().catch(() => {});
  }
}
