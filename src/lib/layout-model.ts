import {
  COMPOUND_MIN_HEIGHT,
  COMPOUND_MIN_WIDTH,
  COMPOUND_PADDING,
} from "./cytoscape-theme";
import { boxesOverlap, detectCollision, resolvePosition, type Point, type VisualBox } from "./collision";

export type { VisualBox };
export { boxesOverlap };

export interface NodePosition {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

function isOverflowNodeId(_id: string): boolean {
  return false;
}

/**
 * Fallback label-inclusive leaf footprint half-extents in model units, used only when a
 * node has no measured `footprint` (see LeafFootprint below). Real leaf nodes get a
 * precise, asymmetric footprint measured from Cytoscape's own rendered label bounds
 * (see measureLeafFootprint in cytoscape-utils.ts), since a label hangs below the shape
 * and can be wider than it - a single symmetric half-height/width can't represent that.
 */
export const LEAF_VISUAL_HALF_W = 18;
export const LEAF_VISUAL_HALF_H = 26;

export const NODE_OVERLAP_PADDING = 8;

/**
 * A leaf's true visual footprint relative to its own center: how far its rendered shape
 * and label actually extend on each side. Asymmetric because `text-valign: bottom` means
 * only the shape (not the label) extends above center, while below center the label may
 * reach further out than the shape, and the label can also be wider than the shape.
 */
export interface LeafFootprint {
  halfW: number;
  halfHTop: number;
  halfHBottom: number;
}

export interface LayoutNodeInput {
  id: string;
  parent?: string;
  isCompound?: boolean;
  isOverflow?: boolean;
  footprint?: LeafFootprint;
}

export interface LayoutNode {
  id: string;
  center: { x: number; y: number };
  size?: { w: number; h: number };
  isCompound: boolean;
  isOverflow: boolean;
  footprint?: LeafFootprint;
  /**
   * Model-unit clearance a compound reserves at its top edge for its title, measured
   * from the title's real rendered DOM box (see GraphParent.setTitleClearance) rather
   * than assumed as a fixed constant. A DOM title has a fixed CSS pixel size that does
   * not scale with Cytoscape's zoom, so the number of *model units* it needs changes
   * with zoom - a static constant would drift as the compound is resized. Falls back to
   * COMPOUND_PADDING.top (see compositeInteriorBox) until a real measurement lands.
   */
  reservedTop?: number;
  /**
   * Model-unit equivalent of CHILD_EDGE_CLEARANCE_PX at the current zoom (see
   * GraphParent.setEdgeClearance), applied to the left/right/bottom interior edges.
   * Recomputed every render tick because zoom can change at any time; falls back to
   * COMPOUND_PADDING.left (see compositeInteriorBox) until the first tick lands.
   */
  reservedEdge?: number;
}

function leafFootprint(node: LayoutNode | undefined): LeafFootprint {
  return (
    node?.footprint ?? {
      halfW: LEAF_VISUAL_HALF_W,
      halfHTop: LEAF_VISUAL_HALF_H,
      halfHBottom: LEAF_VISUAL_HALF_H,
    }
  );
}

export interface WorkPackageLayoutModel {
  nodes: Map<string, LayoutNode>;
  parentOf: Map<string, string>;
  childrenOf: Map<string, string[]>;
  rootIds: string[];
}

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

export function cloneLayoutModel(model: WorkPackageLayoutModel): WorkPackageLayoutModel {
  const nodes = new Map<string, LayoutNode>();
  for (const [id, node] of model.nodes) {
    nodes.set(id, {
      ...node,
      center: { ...node.center },
      size: node.size ? { ...node.size } : undefined,
      footprint: node.footprint ? { ...node.footprint } : undefined,
    });
  }
  return {
    nodes,
    parentOf: new Map(model.parentOf),
    childrenOf: new Map(model.childrenOf),
    rootIds: [...model.rootIds],
  };
}

function setNodeCenter(model: WorkPackageLayoutModel, id: string, center: { x: number; y: number }): void {
  const node = model.nodes.get(id);
  if (!node) {
    return;
  }
  node.center = { x: center.x, y: center.y };
}

export function buildLayoutModel(
  inputs: LayoutNodeInput[],
  flatLayout: Record<string, NodePosition> | undefined,
): WorkPackageLayoutModel {
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  const compoundIds = new Set<string>();

  for (const input of inputs) {
    if (input.parent) {
      parentOf.set(input.id, input.parent);
      const siblings = childrenOf.get(input.parent) ?? [];
      siblings.push(input.id);
      childrenOf.set(input.parent, siblings);
    }
    if (input.isCompound) {
      compoundIds.add(input.id);
    }
  }

  for (const [parentId, childIds] of childrenOf) {
    if (childIds.length > 0) {
      compoundIds.add(parentId);
    }
  }

  const nodes = new Map<string, LayoutNode>();
  for (const input of inputs) {
    const saved = flatLayout?.[input.id];
    const isCompound =
      compoundIds.has(input.id) ||
      (saved?.w !== undefined && saved?.h !== undefined);
    const isOverflow = Boolean(input.isOverflow) || isOverflowNodeId(input.id);
    nodes.set(input.id, {
      id: input.id,
      center: {
        x: saved?.x ?? 0,
        y: saved?.y ?? 0,
      },
      size:
        isCompound && saved?.w !== undefined && saved?.h !== undefined
          ? { w: saved.w, h: saved.h }
          : undefined,
      isCompound,
      isOverflow,
      footprint: !isCompound ? input.footprint : undefined,
    });
  }

  const rootIds = inputs
    .filter((input) => !input.parent && nodes.has(input.id))
    .map((input) => input.id);

  return { nodes, parentOf, childrenOf, rootIds };
}

export function flatLayoutFromModel(model: WorkPackageLayoutModel): Record<string, NodePosition> {
  const layout: Record<string, NodePosition> = {};
  for (const [id, node] of model.nodes) {
    if (node.isOverflow) {
      continue;
    }
    const entry: NodePosition = { x: node.center.x, y: node.center.y };
    if (node.isCompound && node.size) {
      entry.w = node.size.w;
      entry.h = node.size.h;
    }
    layout[id] = entry;
  }
  return layout;
}

export function isAncestor(model: WorkPackageLayoutModel, ancestorId: string, nodeId: string): boolean {
  let current = model.parentOf.get(nodeId);
  while (current) {
    if (current === ancestorId) {
      return true;
    }
    current = model.parentOf.get(current);
  }
  return false;
}

export function canOverlap(
  model: WorkPackageLayoutModel,
  leftId: string,
  rightId: string,
): boolean {
  if (leftId === rightId) {
    return true;
  }
  return isAncestor(model, leftId, rightId) || isAncestor(model, rightId, leftId);
}

export function absoluteCenter(
  model: WorkPackageLayoutModel,
  nodeId: string,
): { x: number; y: number } {
  const node = model.nodes.get(nodeId);
  if (!node) {
    return { x: 0, y: 0 };
  }

  let x = node.center.x;
  let y = node.center.y;
  let parentId = model.parentOf.get(nodeId);
  while (parentId) {
    const parent = model.nodes.get(parentId);
    if (!parent) {
      break;
    }
    x += parent.center.x;
    y += parent.center.y;
    parentId = model.parentOf.get(parentId);
  }
  return { x, y };
}

export function compositeOuterBox(model: WorkPackageLayoutModel, compositeId: string): VisualBox | null {
  const node = model.nodes.get(compositeId);
  if (!node?.isCompound || !node.size) {
    return null;
  }
  const center = absoluteCenter(model, compositeId);
  const halfW = node.size.w / 2;
  const halfH = node.size.h / 2;
  return {
    x1: center.x - halfW,
    y1: center.y - halfH,
    x2: center.x + halfW,
    y2: center.y + halfH,
  };
}

export function compositeInteriorBox(model: WorkPackageLayoutModel, compositeId: string): VisualBox | null {
  const outer = compositeOuterBox(model, compositeId);
  if (!outer) {
    return null;
  }
  const node = model.nodes.get(compositeId);
  const topClearance = node?.reservedTop ?? COMPOUND_PADDING.top;
  const edgeClearance = node?.reservedEdge ?? COMPOUND_PADDING.left;
  return {
    x1: outer.x1 + edgeClearance,
    y1: outer.y1 + topClearance,
    x2: outer.x2 - edgeClearance,
    y2: outer.y2 - edgeClearance,
  };
}

export function visualBox(model: WorkPackageLayoutModel, nodeId: string): VisualBox | null {
  const node = model.nodes.get(nodeId);
  if (!node) {
    return null;
  }

  if (node.isCompound && node.size) {
    return compositeOuterBox(model, nodeId);
  }

  const center = absoluteCenter(model, nodeId);
  const pad = NODE_OVERLAP_PADDING;
  const footprint = leafFootprint(node);
  return {
    x1: center.x - footprint.halfW - pad,
    y1: center.y - footprint.halfHTop - pad,
    x2: center.x + footprint.halfW + pad,
    y2: center.y + footprint.halfHBottom + pad,
  };
}

/**
 * The obstacle list for a given moving node: every other node's current box, except
 * ones it's allowed to overlap (its own ancestors/descendants - e.g. a child is always
 * allowed inside its own parent). Shared by every clamp below so "what counts as an
 * obstacle" is defined in exactly one place, and automatically grows to include more
 * objects (e.g. a second child of the same parent) without any call site changing.
 */
function obstacleBoxesFor(model: WorkPackageLayoutModel, subjectId: string): VisualBox[] {
  const boxes: VisualBox[] = [];
  for (const [otherId] of model.nodes) {
    if (otherId === subjectId || canOverlap(model, subjectId, otherId)) {
      continue;
    }
    const box = visualBox(model, otherId);
    if (box) {
      boxes.push(box);
    }
  }
  return boxes;
}

function descendantIds(model: WorkPackageLayoutModel, rootId: string): Set<string> {
  const result = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const childId of model.childrenOf.get(id) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}

function childrenContentBoxAbsolute(model: WorkPackageLayoutModel, compositeId: string): VisualBox | null {
  const childIds = model.childrenOf.get(compositeId) ?? [];
  if (childIds.length === 0) {
    return null;
  }

  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const childId of childIds) {
    const box = visualBox(model, childId);
    if (!box) {
      continue;
    }
    x1 = Math.min(x1, box.x1);
    y1 = Math.min(y1, box.y1);
    x2 = Math.max(x2, box.x2);
    y2 = Math.max(y2, box.y2);
  }
  if (!Number.isFinite(x1)) {
    return null;
  }
  return { x1, y1, x2, y2 };
}

export function resizeCompoundBoxFromCorner(
  startBox: VisualBox,
  corner: ResizeCorner,
  dxModel: number,
  dyModel: number,
  childrenBox: VisualBox | null,
): VisualBox {
  let { x1, y1, x2, y2 } = startBox;

  const movesEast = corner === "ne" || corner === "se";
  const movesWest = corner === "nw" || corner === "sw";
  const movesNorth = corner === "nw" || corner === "ne";
  const movesSouth = corner === "sw" || corner === "se";

  if (movesEast) {
    x2 = startBox.x2 + dxModel;
    const minRight = Math.max(
      x1 + COMPOUND_MIN_WIDTH,
      childrenBox ? childrenBox.x2 + COMPOUND_PADDING.right : x1 + COMPOUND_MIN_WIDTH,
    );
    x2 = Math.max(x2, minRight);
  }
  if (movesWest) {
    x1 = startBox.x1 + dxModel;
    const maxLeft = Math.min(
      x2 - COMPOUND_MIN_WIDTH,
      childrenBox ? childrenBox.x1 - COMPOUND_PADDING.left : x2 - COMPOUND_MIN_WIDTH,
    );
    x1 = Math.min(x1, maxLeft);
  }
  if (movesSouth) {
    y2 = startBox.y2 + dyModel;
    const minBottom = Math.max(
      y1 + COMPOUND_MIN_HEIGHT,
      childrenBox ? childrenBox.y2 + COMPOUND_PADDING.bottom : y1 + COMPOUND_MIN_HEIGHT,
    );
    y2 = Math.max(y2, minBottom);
  }
  if (movesNorth) {
    y1 = startBox.y1 + dyModel;
    const maxTop = Math.min(
      y2 - COMPOUND_MIN_HEIGHT,
      childrenBox ? childrenBox.y1 - COMPOUND_PADDING.top : y2 - COMPOUND_MIN_HEIGHT,
    );
    y1 = Math.min(y1, maxTop);
  }

  return { x1, y1, x2, y2 };
}

/**
 * Binary-searches the box interpolation from `startBox` to `proposedBox` for the point
 * closest to `proposedBox` that doesn't collide with `obstacles`. Box-resize grows/shrinks
 * independent edges rather than translating a fixed-size shape, so it can't reuse
 * `resolvePosition`'s center-based interpolation directly - but it shares the same
 * `detectCollision` predicate and obstacle list as the center-based clamps below.
 */
function resolveResizeBoxAgainstObstacles(
  startBox: VisualBox,
  proposedBox: VisualBox,
  obstacles: VisualBox[],
): VisualBox {
  if (obstacles.length === 0 || !detectCollision(proposedBox, obstacles)) {
    return proposedBox;
  }

  let low = 0;
  let high = 1;
  let best = { ...startBox };

  for (let iteration = 0; iteration < 40; iteration++) {
    const mid = (low + high) / 2;
    const candidate = {
      x1: startBox.x1 + (proposedBox.x1 - startBox.x1) * mid,
      y1: startBox.y1 + (proposedBox.y1 - startBox.y1) * mid,
      x2: startBox.x2 + (proposedBox.x2 - startBox.x2) * mid,
      y2: startBox.y2 + (proposedBox.y2 - startBox.y2) * mid,
    };

    if (detectCollision(candidate, obstacles)) {
      high = mid;
    } else {
      best = candidate;
      low = mid;
    }
  }

  return best;
}

export function moveComposite(
  model: WorkPackageLayoutModel,
  compositeId: string,
  newCenter: { x: number; y: number },
): WorkPackageLayoutModel {
  const next = cloneLayoutModel(model);
  const node = next.nodes.get(compositeId);
  if (!node?.isCompound || !node.size) {
    return next;
  }

  const size = node.size;
  const parentId = next.parentOf.get(compositeId);
  const parentAbsolute = parentId ? absoluteCenter(next, parentId) : { x: 0, y: 0 };
  const boxForCenter = (center: Point): VisualBox => {
    const absCenter = { x: parentAbsolute.x + center.x, y: parentAbsolute.y + center.y };
    return {
      x1: absCenter.x - size.w / 2,
      y1: absCenter.y - size.h / 2,
      x2: absCenter.x + size.w / 2,
      y2: absCenter.y + size.h / 2,
    };
  };

  const startCenter = { ...node.center };
  const resolved = resolvePosition({
    from: startCenter,
    to: newCenter,
    obstacles: obstacleBoxesFor(next, compositeId),
    boxForCenter,
  });
  setNodeCenter(next, compositeId, resolved);
  return next;
}

export function moveChild(
  model: WorkPackageLayoutModel,
  childId: string,
  newRelativeCenter: { x: number; y: number },
): WorkPackageLayoutModel {
  const next = cloneLayoutModel(model);
  const node = next.nodes.get(childId);
  const parentId = next.parentOf.get(childId);
  if (!node || !parentId) {
    return next;
  }

  const footprint = leafFootprint(node);
  const boxForCenter = (center: Point): VisualBox => ({
    x1: center.x - footprint.halfW,
    y1: center.y - footprint.halfHTop,
    x2: center.x + footprint.halfW,
    y2: center.y + footprint.halfHBottom,
  });

  const parentAbsolute = absoluteCenter(next, parentId);
  const startAbsolute = absoluteCenter(next, childId);
  const proposedAbsolute = {
    x: parentAbsolute.x + newRelativeCenter.x,
    y: parentAbsolute.y + newRelativeCenter.y,
  };

  const resolvedAbsolute = resolvePosition({
    from: startAbsolute,
    to: proposedAbsolute,
    bounds: compositeInteriorBox(next, parentId),
    obstacles: obstacleBoxesFor(next, childId),
    boxForCenter,
  });

  setNodeCenter(next, childId, {
    x: resolvedAbsolute.x - parentAbsolute.x,
    y: resolvedAbsolute.y - parentAbsolute.y,
  });
  return next;
}

export function resizeComposite(
  model: WorkPackageLayoutModel,
  compositeId: string,
  corner: ResizeCorner,
  dxModel: number,
  dyModel: number,
): WorkPackageLayoutModel {
  const next = cloneLayoutModel(model);
  const node = next.nodes.get(compositeId);
  const startOuter = compositeOuterBox(next, compositeId);
  if (!node?.isCompound || !node.size || !startOuter) {
    return next;
  }

  const childrenBox = childrenContentBoxAbsolute(next, compositeId);
  const proposedOuter = resizeCompoundBoxFromCorner(
    startOuter,
    corner,
    dxModel,
    dyModel,
    childrenBox,
  );
  const clampedOuter = resolveResizeBoxAgainstObstacles(
    startOuter,
    proposedOuter,
    obstacleBoxesFor(next, compositeId),
  );

  const savedAbsolute = new Map<string, { x: number; y: number }>();
  for (const descendantId of descendantIds(next, compositeId)) {
    if (descendantId === compositeId) {
      continue;
    }
    savedAbsolute.set(descendantId, absoluteCenter(next, descendantId));
  }

  const w = clampedOuter.x2 - clampedOuter.x1;
  const h = clampedOuter.y2 - clampedOuter.y1;
  node.size = { w, h };
  setNodeCenter(next, compositeId, {
    x: (clampedOuter.x1 + clampedOuter.x2) / 2,
    y: (clampedOuter.y1 + clampedOuter.y2) / 2,
  });

  const descendants = [...descendantIds(next, compositeId)].filter((id) => id !== compositeId);
  descendants.sort(
    (leftId, rightId) => modelDepth(next, leftId) - modelDepth(next, rightId),
  );
  for (const descendantId of descendants) {
    const saved = savedAbsolute.get(descendantId);
    const parentId = next.parentOf.get(descendantId);
    if (!saved || !parentId) {
      continue;
    }
    const parentAbsolute = absoluteCenter(next, parentId);
    setNodeCenter(next, descendantId, {
      x: saved.x - parentAbsolute.x,
      y: saved.y - parentAbsolute.y,
    });
  }

  return next;
}

function modelDepth(model: WorkPackageLayoutModel, nodeId: string): number {
  let depth = 0;
  let parentId = model.parentOf.get(nodeId);
  while (parentId) {
    depth += 1;
    parentId = model.parentOf.get(parentId);
  }
  return depth;
}

export function subtreeNodeIds(model: WorkPackageLayoutModel, rootId: string): string[] {
  return [...descendantIds(model, rootId)];
}

export function nodesOverlapInModel(
  model: WorkPackageLayoutModel,
  leftId: string,
  rightId: string,
): boolean {
  const left = visualBox(model, leftId);
  const right = visualBox(model, rightId);
  if (!left || !right) {
    return false;
  }
  return boxesOverlap(left, right);
}
