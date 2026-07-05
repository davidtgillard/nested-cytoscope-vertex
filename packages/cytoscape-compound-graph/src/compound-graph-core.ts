import type { Core } from "cytoscape";
import {
  INITIAL_COMPOUND_SLACK,
  compoundSizeForContent,
} from "./cytoscape-utils";
import {
  absoluteCenter,
  compositeOuterBox,
  subtreeNodeIds,
  type WorkPackageLayoutModel,
} from "./layout-model";

export interface RenderedBoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function renderedBoxRect(
  cy: Core,
  box: { x1: number; y1: number; x2: number; y2: number },
): RenderedBoxRect {
  const pan = cy.pan();
  const zoom = cy.zoom();
  return {
    left: box.x1 * zoom + pan.x,
    top: box.y1 * zoom + pan.y,
    width: (box.x2 - box.x1) * zoom,
    height: (box.y2 - box.y1) * zoom,
  };
}

export function renderedContainerBoxFromModel(
  cy: Core,
  model: WorkPackageLayoutModel,
  containerId: string,
): RenderedBoxRect | null {
  const box = compositeOuterBox(model, containerId);
  if (!box) {
    return null;
  }
  return renderedBoxRect(cy, box);
}

export function measureContainerFromCy(cy: Core, containerId: string, childIds: string[]): void {
  cy.batch(() => {
    const parent = cy.getElementById(containerId);
    if (parent.empty() || parent.data("compoundWidth") !== undefined) {
      return;
    }

    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    let hasChild = false;
    for (const childId of childIds) {
      const child = cy.getElementById(childId);
      if (child.empty()) {
        continue;
      }
      hasChild = true;
      const box = child.boundingBox({ includeLabels: true, includeOverlays: false });
      x1 = Math.min(x1, box.x1);
      y1 = Math.min(y1, box.y1);
      x2 = Math.max(x2, box.x2);
      y2 = Math.max(y2, box.y2);
    }
    if (!hasChild) {
      return;
    }

    const fit = compoundSizeForContent({ x1, y1, x2, y2 });
    const w = fit.w + INITIAL_COMPOUND_SLACK;
    const h = fit.h + INITIAL_COMPOUND_SLACK;
    parent.data("compoundWidth", w);
    parent.data("compoundHeight", h);
    parent.position({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
  });
}

export function pinContainerToModel(
  cy: Core,
  model: WorkPackageLayoutModel,
  containerId: string,
): void {
  const parentNode = model.nodes.get(containerId);
  const parentSize = parentNode?.size;
  if (!parentNode || !parentSize) {
    return;
  }
  const cyParent = cy.getElementById(containerId);
  if (cyParent.empty()) {
    return;
  }
  cy.batch(() => {
    cyParent.data("compoundWidth", parentSize.w);
    cyParent.data("compoundHeight", parentSize.h);
    cyParent.position({ x: parentNode.center.x, y: parentNode.center.y });
  });
}

export function applySubtreePositionsToCy(
  cy: Core,
  model: WorkPackageLayoutModel,
  rootId: string,
): void {
  for (const nodeId of subtreeNodeIds(model, rootId)) {
    if (nodeId === rootId) {
      continue;
    }
    const cyNode = cy.getElementById(nodeId);
    if (cyNode.empty()) {
      continue;
    }
    cyNode.position(absoluteCenter(model, nodeId));
  }
}

export function enableContainerDragging(cy: Core, containerIds: string[]): void {
  for (const containerId of containerIds) {
    const parent = cy.getElementById(containerId);
    if (!parent.empty()) {
      parent.unlock();
      parent.grabify();
    }
  }
}

export function configureDetachedChildDrag(cy: Core, leafIds: string[]): void {
  for (const childId of leafIds) {
    const child = cy.getElementById(childId);
    if (!child.empty()) {
      child.ungrabify();
    }
  }
}

export function restoreLeafVisibility(cy: Core, leafIds: string[]): void {
  for (const childId of leafIds) {
    const child = cy.getElementById(childId);
    if (!child.empty()) {
      child.removeStyle();
    }
  }
}
