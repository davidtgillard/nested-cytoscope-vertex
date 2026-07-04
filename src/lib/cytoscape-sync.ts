import type { Core } from "cytoscape";
import { applyFrozenCompoundSize } from "./cytoscape-utils";
import { graphNodeModelPosition } from "./cytoscape-utils";
import {
  absoluteCenter,
  buildLayoutModel,
  type LayoutNodeInput,
  type WorkPackageLayoutModel,
} from "./layout-model";

export type SyncMode =
  | "model"
  | "model-plus-frozen-top-left"
  | "cy-direct-frozen";

function modelDepth(model: WorkPackageLayoutModel, nodeId: string): number {
  let depth = 0;
  let parentId = model.parentOf.get(nodeId);
  while (parentId) {
    depth += 1;
    parentId = model.parentOf.get(parentId);
  }
  return depth;
}

/**
 * Cytoscape always reports node positions in global graph coordinates. Our layout
 * model, however, stores each node's "center" relative to its immediate parent (see
 * absoluteCenter/moveChild in layout-model.ts). So when reading a child back out of
 * Cytoscape we must subtract its parent's global position to land back in the
 * model's relative frame.
 */
export function layoutModelFromCy(cy: Core, inputs: LayoutNodeInput[]): WorkPackageLayoutModel {
  const flat: Record<string, { x: number; y: number; w?: number; h?: number }> = {};
  for (const input of inputs) {
    const node = cy.getElementById(input.id);
    if (node.empty()) {
      continue;
    }
    const absolute = graphNodeModelPosition(node);
    let center = { x: absolute.x, y: absolute.y };
    if (input.parent) {
      const parentNode = cy.getElementById(input.parent);
      if (!parentNode.empty()) {
        const parentAbsolute = graphNodeModelPosition(parentNode);
        center = { x: absolute.x - parentAbsolute.x, y: absolute.y - parentAbsolute.y };
      }
    }
    const position: { x: number; y: number; w?: number; h?: number } = center;
    const width = node.data("compoundWidth");
    const height = node.data("compoundHeight");
    if (width !== undefined && height !== undefined) {
      position.w = Number(width);
      position.h = Number(height);
    }
    flat[input.id] = position;
  }
  return buildLayoutModel(inputs, flat);
}

/**
 * bellman-gui current: model centre is authoritative. The container is a plain node
 * (see cytoscape-theme.ts), so writing every node's absolute center directly is all
 * that's needed - there's no compound bounds-fitting to fight against.
 */
function applyModelSync(cy: Core, model: WorkPackageLayoutModel): void {
  const sortedIds = [...model.nodes.keys()].sort(
    (leftId, rightId) => modelDepth(model, leftId) - modelDepth(model, rightId),
  );

  cy.batch(() => {
    for (const nodeId of sortedIds) {
      const layoutNode = model.nodes.get(nodeId);
      if (!layoutNode || layoutNode.isOverflow || !layoutNode.isCompound || !layoutNode.size) {
        continue;
      }
      const cyNode = cy.getElementById(nodeId);
      if (cyNode.empty()) {
        continue;
      }
      cyNode.data("compoundWidth", layoutNode.size.w);
      cyNode.data("compoundHeight", layoutNode.size.h);
    }

    for (const nodeId of sortedIds) {
      const layoutNode = model.nodes.get(nodeId);
      if (!layoutNode || layoutNode.isOverflow) {
        continue;
      }
      const cyNode = cy.getElementById(nodeId);
      if (cyNode.empty()) {
        continue;
      }
      const absolute = absoluteCenter(model, nodeId);
      cyNode.position({ x: absolute.x, y: absolute.y });
    }
  });
}

/** Old bellman behaviour: applyFrozenCompoundSize after positioning children. */
function applyModelPlusFrozenSync(cy: Core, model: WorkPackageLayoutModel): void {
  applyModelSync(cy, model);
  cy.batch(() => {
    for (const [nodeId, layoutNode] of model.nodes) {
      if (!layoutNode.isCompound || !layoutNode.size) {
        continue;
      }
      const cyNode = cy.getElementById(nodeId);
      if (cyNode.empty()) {
        continue;
      }
      const absolute = absoluteCenter(model, nodeId);
      cyNode.position({ x: absolute.x, y: absolute.y });
      applyFrozenCompoundSize(cyNode, layoutNode.size.w, layoutNode.size.h);
    }
  });
}

/** Naive: set container size via applyFrozenCompoundSize only (children relative unchanged). */
function applyCyDirectFrozenSync(cy: Core, model: WorkPackageLayoutModel): void {
  cy.batch(() => {
    for (const [nodeId, layoutNode] of model.nodes) {
      const cyNode = cy.getElementById(nodeId);
      if (cyNode.empty()) {
        continue;
      }
      if (layoutNode.isCompound && layoutNode.size) {
        applyFrozenCompoundSize(cyNode, layoutNode.size.w, layoutNode.size.h);
        const absolute = absoluteCenter(model, nodeId);
        cyNode.position({ x: absolute.x, y: absolute.y });
      } else if (!layoutNode.isCompound) {
        const absolute = absoluteCenter(model, nodeId);
        cyNode.position({ x: absolute.x, y: absolute.y });
      }
    }
  });
}

export function applyLayoutModelToCy(
  cy: Core,
  model: WorkPackageLayoutModel,
  mode: SyncMode = "model",
): void {
  switch (mode) {
    case "model":
      applyModelSync(cy, model);
      break;
    case "model-plus-frozen-top-left":
      applyModelPlusFrozenSync(cy, model);
      break;
    case "cy-direct-frozen":
      applyCyDirectFrozenSync(cy, model);
      break;
  }
  cy.resize();
}
