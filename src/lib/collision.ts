/**
 * Pure box/position geometry shared by every clamp in layout-model.ts (child-in-parent,
 * compound-vs-compound, resize-vs-sibling). None of these functions know what a "child"
 * or a "compound" is - they only deal in boxes and centers - so the same math keeps
 * working unchanged as more objects (e.g. additional children of one parent) are added;
 * callers just need to supply a longer `obstacles` list. This module has no dependency
 * on layout-model.ts (it's the other way around) so it stays reusable and easy to test
 * in isolation.
 */

export interface VisualBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Point {
  x: number;
  y: number;
}

export function boxesOverlap(left: VisualBox, right: VisualBox): boolean {
  return left.x1 < right.x2 && left.x2 > right.x1 && left.y1 < right.y2 && left.y2 > right.y1;
}

/** True if `box` overlaps any of the given obstacle boxes. */
export function detectCollision(box: VisualBox, obstacles: VisualBox[]): boolean {
  return obstacles.some((obstacle) => boxesOverlap(box, obstacle));
}

/** The translation that brings `box` fully inside `bounds` ({dx:0, dy:0} if already inside). */
export function containmentShift(box: VisualBox, bounds: VisualBox): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  if (box.x1 < bounds.x1) {
    dx = bounds.x1 - box.x1;
  } else if (box.x2 > bounds.x2) {
    dx = bounds.x2 - box.x2;
  }
  if (box.y1 < bounds.y1) {
    dy = bounds.y1 - box.y1;
  } else if (box.y2 > bounds.y2) {
    dy = bounds.y2 - box.y2;
  }
  return { dx, dy };
}

function keepInside(
  center: Point,
  bounds: VisualBox | null,
  boxForCenter: (center: Point) => VisualBox | null,
): Point {
  if (!bounds) {
    return center;
  }
  const box = boxForCenter(center);
  if (!box) {
    return center;
  }
  const { dx, dy } = containmentShift(box, bounds);
  return { x: center.x + dx, y: center.y + dy };
}

/**
 * Binary-searches the line from `from` to `to` for the point closest to `to` whose box
 * does not collide with any `obstacles`. Assumes `from` itself is collision-free (it's
 * the last known-good position), matching how a drag/resize gesture always starts from a
 * valid state.
 */
function resolveAgainstObstacles(
  from: Point,
  to: Point,
  obstacles: VisualBox[],
  boxForCenter: (center: Point) => VisualBox | null,
): Point {
  if (obstacles.length === 0) {
    return to;
  }

  const collidesAt = (center: Point): boolean => {
    const box = boxForCenter(center);
    return box === null || detectCollision(box, obstacles);
  };

  if (!collidesAt(to)) {
    return to;
  }

  let low = 0;
  let high = 1;
  let best = { ...from };

  for (let iteration = 0; iteration < 40; iteration++) {
    const mid = (low + high) / 2;
    const candidate = {
      x: from.x + (to.x - from.x) * mid,
      y: from.y + (to.y - from.y) * mid,
    };
    if (collidesAt(candidate)) {
      high = mid;
    } else {
      best = candidate;
      low = mid;
    }
  }

  return best;
}

/**
 * Resolves a proposed move from `from` to `to`: keeps the box inside `bounds` (if any),
 * then pushes it back out of any `obstacles` it still collides with, then re-clamps to
 * `bounds` once more. The extra containment pass is cheap insurance - pushing out of an
 * obstacle can't carry the box back outside bounds it already satisfied, since the
 * binary search only ever moves the candidate back toward the known-good `from` point.
 */
export function resolvePosition(params: {
  from: Point;
  to: Point;
  bounds?: VisualBox | null;
  obstacles?: VisualBox[];
  boxForCenter: (center: Point) => VisualBox | null;
}): Point {
  const { from, to, bounds = null, obstacles = [], boxForCenter } = params;
  let candidate = keepInside(to, bounds, boxForCenter);
  candidate = resolveAgainstObstacles(from, candidate, obstacles, boxForCenter);
  candidate = keepInside(candidate, bounds, boxForCenter);
  return candidate;
}
