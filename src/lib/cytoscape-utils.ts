import type { Core, NodeSingular } from "cytoscape";
import { COMPOUND_MIN_HEIGHT, COMPOUND_MIN_WIDTH, COMPOUND_PADDING } from "./cytoscape-theme";

export interface Point {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/**
 * Cytoscape stores every node's position in plain global graph coordinates. The
 * "container" node is a regular node (not a real compound parent - see
 * cytoscape-theme.ts for why), so there is no nesting to walk here; this helper
 * exists mainly for call-site readability/API stability.
 */
export function compoundAbsolutePosition(node: NodeSingular): Point {
  const position = node.position();
  return { x: position.x, y: position.y };
}

export function graphNodeModelPosition(node: NodeSingular): Point {
  return node.position();
}

/**
 * Measures a leaf's true rendered footprint relative to its own center, using
 * Cytoscape's own label metrics (`boundingBox({ includeLabels })`) rather than a
 * guessed constant. `text-valign: bottom` means the label hangs below the shape and can
 * be wider than it, so the shape-only box gives the top extent (nothing renders above
 * center) while the label-inclusive box gives the bottom/width extent. This works even
 * while the node is hidden mid-drag (opacity 0), since boundingBox is geometry-based.
 */
export function measureLeafFootprint(node: NodeSingular): {
  halfW: number;
  halfHTop: number;
  halfHBottom: number;
} {
  const center = node.position();
  const shapeBox = node.boundingBox({ includeLabels: false, includeOverlays: false });
  const fullBox = node.boundingBox({ includeLabels: true, includeOverlays: false });
  return {
    halfW: Math.max(center.x - fullBox.x1, fullBox.x2 - center.x),
    halfHTop: center.y - shapeBox.y1,
    halfHBottom: fullBox.y2 - center.y,
  };
}

export function compoundSizeForContent(contentBox: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} | null): { w: number; h: number } {
  if (!contentBox) {
    return { w: COMPOUND_MIN_WIDTH, h: COMPOUND_MIN_HEIGHT };
  }
  const contentWidth = contentBox.x2 - contentBox.x1;
  const contentHeight = contentBox.y2 - contentBox.y1;
  return {
    w: Math.max(
      COMPOUND_MIN_WIDTH,
      contentWidth + COMPOUND_PADDING.left + COMPOUND_PADDING.right,
    ),
    h: Math.max(
      COMPOUND_MIN_HEIGHT,
      contentHeight + COMPOUND_PADDING.top + COMPOUND_PADDING.bottom,
    ),
  };
}

/**
 * Extra room (beyond the tight content+padding fit) baked into the compound's *initial*
 * size so the child starts with some room to be dragged around at all, rather than
 * spawning already touching every edge. This constant is added once to both width and
 * height and then split evenly on every side (the container is always centered on the
 * child - see measureAndPinCompound below) - so it's the dominant term in how far the
 * child can travel before hitting the (now tight) edge clamp, independent of
 * COMPOUND_PADDING. Kept small since the edges themselves are already only as far away
 * as COMPOUND_PADDING plus the child's own measured footprint demand.
 */
export const INITIAL_COMPOUND_SLACK = 24;

/**
 * Resizes a plain (non-compound) node while keeping its top-left corner fixed.
 * Cytoscape resizes a plain node's shape around its existing center, so to keep
 * the top-left anchored we shift the position by half the size delta ourselves.
 */
export function applyFrozenCompoundSize(node: NodeSingular, w: number, h: number): void {
  const beforeW = Number(node.data("compoundWidth"));
  const beforeH = Number(node.data("compoundHeight"));
  const hasBefore = Number.isFinite(beforeW) && Number.isFinite(beforeH);

  node.data("compoundWidth", w);
  node.data("compoundHeight", h);

  if (!hasBefore) {
    return;
  }
  const dw = w - beforeW;
  const dh = h - beforeH;
  if (dw === 0 && dh === 0) {
    return;
  }

  const position = node.position();
  node.position({ x: position.x + dw / 2, y: position.y + dh / 2 });
}

/**
 * One-time initialization for the "measured" scenario: size the container to fit
 * around the child's current bounding box, centering the container on the child so
 * the child's own (already-correct) position never needs to move. Since the
 * container is a plain node with no real Cytoscape children, sizing it can never
 * have the side effect of dragging the child along - unlike Cytoscape's native
 * compound bounds-fitting, which always keeps a lone child's own bounding box
 * pinned to a bias-anchored corner of the parent (see cytoscape-theme.ts).
 */
export function measureAndPinCompound(
  container: NodeSingular,
  child: NodeSingular,
  w: number,
  h: number,
): void {
  const childPosition = child.position();
  container.data("compoundWidth", w);
  container.data("compoundHeight", h);
  container.position({ x: childPosition.x, y: childPosition.y });
}

export function snapshotGraphState(cy: Core, parentId: string, childIds: string[]) {
  const parent = cy.getElementById(parentId);
  const w = Number(parent.data("compoundWidth"));
  const h = Number(parent.data("compoundHeight"));
  const center = compoundAbsolutePosition(parent);
  return {
    parent: {
      center,
      relative: parent.position(),
      w,
      h,
      box: {
        x1: center.x - w / 2,
        y1: center.y - h / 2,
        x2: center.x + w / 2,
        y2: center.y + h / 2,
      },
    },
    children: Object.fromEntries(
      childIds.map((id) => {
        const node = cy.getElementById(id);
        return [
          id,
          {
            absolute: compoundAbsolutePosition(node),
            relative: node.position(),
          },
        ];
      }),
    ),
  };
}

export type GraphSnapshot = ReturnType<typeof snapshotGraphState>;

export function snapshotDelta(
  before: GraphSnapshot,
  after: GraphSnapshot,
): Record<string, { dx: number; dy: number }> {
  const delta: Record<string, { dx: number; dy: number }> = {};
  for (const [id, childBefore] of Object.entries(before.children)) {
    const childAfter = after.children[id];
    if (!childAfter) {
      continue;
    }
    delta[id] = {
      dx: childAfter.absolute.x - childBefore.absolute.x,
      dy: childAfter.absolute.y - childBefore.absolute.y,
    };
  }
  return delta;
}
