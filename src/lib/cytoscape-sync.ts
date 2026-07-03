import type { Core } from "cytoscape";
import { applyFrozenCompoundSize } from "./cytoscape-utils";
import { graphNodeModelPosition } from "./cytoscape-utils";
import {
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

export function layoutModelFromCy(cy: Core, inputs: LayoutNodeInput[]): WorkPackageLayoutModel {
  const flat: Record<string, { x: number; y: number; w?: number; h?: number }> = {};
  for (const input of inputs) {
    const node = cy.getElementById(input.id);
    if (node.empty()) {
      continue;
    }
    const position = graphNodeModelPosition(node);
    if (node.isParent()) {
      const width = node.data("compoundWidth");
      const height = node.data("compoundHeight");
      if (width !== undefined && height !== undefined) {
        position.w = Number(width);
        position.h = Number(height);
      }
    }
    flat[input.id] = position;
  }
  return buildLayoutModel(inputs, flat);
}

/** bellman-gui current: model centre is authoritative; no applyFrozenCompoundSize. */
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
      cyNode.unlock();
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
      if (layoutNode.isCompound) {
        cyNode.unlock();
      }
      cyNode.position({ x: layoutNode.center.x, y: layoutNode.center.y });
      if (layoutNode.isCompound && layoutNode.size && cyNode.isParent() && cyNode.children().length > 0) {
        cyNode.lock();
      }
    }

    for (const nodeId of [...sortedIds].reverse()) {
      const layoutNode = model.nodes.get(nodeId);
      if (!layoutNode || layoutNode.isOverflow || layoutNode.isCompound) {
        continue;
      }
      const cyNode = cy.getElementById(nodeId);
      if (cyNode.empty()) {
        continue;
      }
      cyNode.position({ x: layoutNode.center.x, y: layoutNode.center.y });
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
      if (cyNode.empty() || !cyNode.isParent()) {
        continue;
      }
      cyNode.unlock();
      cyNode.position({ x: layoutNode.center.x, y: layoutNode.center.y });
      applyFrozenCompoundSize(cyNode, layoutNode.size.w, layoutNode.size.h);
      cyNode.lock();
    }
  });
}

/** Naive: set parent size via applyFrozenCompoundSize only (children relative unchanged). */
function applyCyDirectFrozenSync(cy: Core, model: WorkPackageLayoutModel): void {
  cy.batch(() => {
    for (const [nodeId, layoutNode] of model.nodes) {
      const cyNode = cy.getElementById(nodeId);
      if (cyNode.empty()) {
        continue;
      }
      if (layoutNode.isCompound && layoutNode.size) {
        cyNode.unlock();
        applyFrozenCompoundSize(cyNode, layoutNode.size.w, layoutNode.size.h);
        cyNode.position({ x: layoutNode.center.x, y: layoutNode.center.y });
        if (cyNode.isParent() && cyNode.children().length > 0) {
          cyNode.lock();
        }
      } else if (!layoutNode.isCompound) {
        cyNode.position({ x: layoutNode.center.x, y: layoutNode.center.y });
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
