/** Clamp the entire exported (already rotated) asset, including transparent edges. */
export function constrainPosition(x, y, item, boundary) {
  if (!boundary) return { x, y };
  return {
    x: Math.min(Math.max(0, boundary.width - item.width), Math.max(0, x)),
    y: Math.min(Math.max(0, boundary.height - item.height), Math.max(0, y)),
  };
}

/** Convert a screen-space vector through the inverse linear ancestor transform. */
export function localDelta(dx, dy, { a, b, c, d }) {
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-10) return { x: 0, y: 0 };
  return { x: (d * dx - c * dy) / determinant, y: (-b * dx + a * dy) / determinant };
}
