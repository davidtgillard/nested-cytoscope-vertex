import {
  COMPOUND_MIN_HEIGHT,
  COMPOUND_MIN_WIDTH,
  COMPOUND_PADDING,
} from "./cytoscape-theme";

export interface NodePosition {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface VisualBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function shiftBoxInside(
  box: VisualBox,
  interior: VisualBox,
): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  if (box.x1 < interior.x1) {
    dx = interior.x1 - box.x1;
  } else if (box.x2 > interior.x2) {
    dx = interior.x2 - box.x2;
  }
  if (box.y1 < interior.y1) {
    dy = interior.y1 - box.y1;
  } else if (box.y2 > interior.y2) {
    dy = interior.y2 - box.y2;
  }
  return { dx, dy };
}

function isOverflowNodeId(_id: string): boolean {
  return false;
}

/** Label-inclusive leaf footprint half-extents in model units (matches cytoscape theme). */
export const LEAF_VISUAL_HALF_W = 18;
export const LEAF_VISUAL_HALF_H = 26;

export const NODE_OVERLAP_PADDING = 8;

export interface LayoutNodeInput {
  id: string;
  parent?: string;
  isCompound?: boolean;
  isOverflow?: boolean;
}

export interface LayoutNode {
  id: string;
  center: { x: number; y: number };
  size?: { w: number; h: number };
  isCompound: boolean;
  isOverflow: boolean;
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
  return {
    x1: outer.x1 + COMPOUND_PADDING.left,
    y1: outer.y1 + COMPOUND_PADDING.top,
    x2: outer.x2 - COMPOUND_PADDING.right,
    y2: outer.y2 - COMPOUND_PADDING.bottom,
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
  return {
    x1: center.x - LEAF_VISUAL_HALF_W - pad,
    y1: center.y - LEAF_VISUAL_HALF_H - pad,
    x2: center.x + LEAF_VISUAL_HALF_W + pad,
    y2: center.y + LEAF_VISUAL_HALF_H + pad,
  };
}

export function boxesOverlap(left: VisualBox, right: VisualBox): boolean {
  return (
    left.x1 < right.x2 &&
    left.x2 > right.x1 &&
    left.y1 < right.y2 &&
    left.y2 > right.y1
  );
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

function clampCenterForOverlap(
  model: WorkPackageLayoutModel,
  subjectId: string,
  startCenter: { x: number; y: number },
  proposedCenter: { x: number; y: number },
  boxForCenter: (center: { x: number; y: number }) => VisualBox | null,
): { x: number; y: number } {
  const saved = model.nodes.get(subjectId)?.center;
  if (!saved) {
    return startCenter;
  }

  const overlapsAt = (center: { x: number; y: number }): boolean => {
    setNodeCenter(model, subjectId, center);
    const movingBox = boxForCenter(center);
    if (!movingBox) {
      return true;
    }
    for (const [otherId] of model.nodes) {
      if (otherId === subjectId || canOverlap(model, subjectId, otherId)) {
        continue;
      }
      const otherBox = visualBox(model, otherId);
      if (otherBox && boxesOverlap(movingBox, otherBox)) {
        return true;
      }
    }
    return false;
  };

  if (!overlapsAt(proposedCenter)) {
    setNodeCenter(model, subjectId, saved);
    return proposedCenter;
  }

  let low = 0;
  let high = 1;
  let best = { ...startCenter };

  for (let iteration = 0; iteration < 40; iteration++) {
    const mid = (low + high) / 2;
    const candidate = {
      x: startCenter.x + (proposedCenter.x - startCenter.x) * mid,
      y: startCenter.y + (proposedCenter.y - startCenter.y) * mid,
    };

    if (overlapsAt(candidate)) {
      high = mid;
    } else {
      best = candidate;
      low = mid;
    }
  }

  setNodeCenter(model, subjectId, saved);
  return best;
}

function clampChildInterior(
  model: WorkPackageLayoutModel,
  childId: string,
  relativeCenter: { x: number; y: number },
): { x: number; y: number } {
  const parentId = model.parentOf.get(childId);
  if (!parentId) {
    return relativeCenter;
  }

  const interior = compositeInteriorRelativeBox(model, parentId);
  if (!interior) {
    return relativeCenter;
  }

  const footprint: VisualBox = {
    x1: relativeCenter.x - LEAF_VISUAL_HALF_W,
    y1: relativeCenter.y - LEAF_VISUAL_HALF_H,
    x2: relativeCenter.x + LEAF_VISUAL_HALF_W,
    y2: relativeCenter.y + LEAF_VISUAL_HALF_H,
  };
  const { dx, dy } = shiftBoxInside(footprint, interior);
  return { x: relativeCenter.x + dx, y: relativeCenter.y + dy };
}

function compositeInteriorRelativeBox(
  model: WorkPackageLayoutModel,
  compositeId: string,
): VisualBox | null {
  const interior = compositeInteriorBox(model, compositeId);
  if (!interior) {
    return null;
  }
  const parentCenter = model.nodes.get(compositeId)?.center;
  if (!parentCenter) {
    return null;
  }
  return {
    x1: interior.x1 - parentCenter.x,
    y1: interior.y1 - parentCenter.y,
    x2: interior.x2 - parentCenter.x,
    y2: interior.y2 - parentCenter.y,
  };
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

function clampResizeBoxForOverlap(
  model: WorkPackageLayoutModel,
  compositeId: string,
  startBox: VisualBox,
  proposedBox: VisualBox,
): VisualBox {
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

    let overlaps = false;
    for (const [otherId] of model.nodes) {
      if (otherId === compositeId || canOverlap(model, compositeId, otherId)) {
        continue;
      }
      const otherBox = visualBox(model, otherId);
      if (otherBox && boxesOverlap(candidate, otherBox)) {
        overlaps = true;
        break;
      }
    }

    if (overlaps) {
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
  if (!node?.isCompound) {
    return next;
  }

  const startCenter = { ...node.center };
  const clamped = clampCenterForOverlap(
    next,
    compositeId,
    startCenter,
    newCenter,
    () => compositeOuterBox(next, compositeId),
  );
  setNodeCenter(next, compositeId, clamped);
  return next;
}

export function moveChild(
  model: WorkPackageLayoutModel,
  childId: string,
  newRelativeCenter: { x: number; y: number },
): WorkPackageLayoutModel {
  const next = cloneLayoutModel(model);
  const node = next.nodes.get(childId);
  if (!node || !next.parentOf.has(childId)) {
    return next;
  }

  const startRelative = { ...node.center };
  let proposed = clampChildInterior(next, childId, newRelativeCenter);

  const clampedRelative = clampCenterForOverlap(
    next,
    childId,
    startRelative,
    proposed,
    (relativeCenter) => {
      setNodeCenter(next, childId, relativeCenter);
      const box = visualBox(next, childId);
      setNodeCenter(next, childId, startRelative);
      return box;
    },
  );

  proposed = clampChildInterior(next, childId, clampedRelative);
  setNodeCenter(next, childId, proposed);
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
  const clampedOuter = clampResizeBoxForOverlap(next, compositeId, startOuter, proposedOuter);

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
