import type { Core, NodeSingular } from "cytoscape";
import { COMPOUND_MIN_HEIGHT, COMPOUND_MIN_WIDTH, COMPOUND_PADDING } from "./cytoscape-theme";

export interface Point {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export function compoundAbsolutePosition(node: NodeSingular): Point {
  const position = node.position();
  const parent = node.parent();
  if (parent.empty()) {
    return { x: position.x, y: position.y };
  }

  const parentAbsolute = compoundAbsolutePosition(parent.first());
  return {
    x: parentAbsolute.x + position.x,
    y: parentAbsolute.y + position.y,
  };
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
 * Pins compound size while keeping the top-left corner fixed (bellman-gui helper).
 */
export function applyFrozenCompoundSize(node: NodeSingular, w: number, h: number): void {
  const before = node.boundingBox({ includeLabels: false, includeOverlays: false });
  const topLeftX = before.x1;
  const topLeftY = before.y1;

  node.data("compoundWidth", w);
  node.data("compoundHeight", h);

  const after = node.boundingBox({ includeLabels: false, includeOverlays: false });
  const dx = topLeftX - after.x1;
  const dy = topLeftY - after.y1;
  if (dx === 0 && dy === 0) {
    return;
  }

  const position = node.position();
  node.position({ x: position.x + dx, y: position.y + dy });
}

export function compoundChromeRenderedBox(node: NodeSingular): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  node.cy().resize();
  return node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
}

export function measureAndPinCompound(
  parent: NodeSingular,
  w: number,
  h: number,
  preserveChildAbsolute: boolean,
): void {
  const children = parent.children();
  const childAbsBefore = new Map<string, Point>();
  if (preserveChildAbsolute) {
    children.forEach((child) => {
      childAbsBefore.set(child.id(), compoundAbsolutePosition(child));
    });
  }

  applyFrozenCompoundSize(parent, w, h);

  if (preserveChildAbsolute) {
    children.forEach((child) => {
      const abs = childAbsBefore.get(child.id());
      if (!abs) {
        return;
      }
      const parentAbs = compoundAbsolutePosition(parent);
      child.position({
        x: abs.x - parentAbs.x,
        y: abs.y - parentAbs.y,
      });
    });
  }

  if (parent.isParent() && parent.children().length > 0) {
    parent.lock();
  }
}

export function snapshotGraphState(cy: Core, parentId: string, childIds: string[]) {
  const parent = cy.getElementById(parentId);
  const parentBox = parent.boundingBox({ includeLabels: false, includeOverlays: false });
  return {
    parent: {
      center: compoundAbsolutePosition(parent),
      relative: parent.position(),
      w: Number(parent.data("compoundWidth")),
      h: Number(parent.data("compoundHeight")),
      box: { x1: parentBox.x1, y1: parentBox.y1, x2: parentBox.x2, y2: parentBox.y2 },
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
