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

export const INITIAL_COMPOUND_SLACK = 56;

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
