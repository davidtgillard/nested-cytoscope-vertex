import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";
import { createCompoundGraphStylesheet } from "./cytoscape-theme";
import {
  applyFrozenCompoundSize,
  childFitBoxAbsoluteFromCy,
  compoundSizeForContent,
  snapshotDelta,
  syncLeafFootprintsFromCy,
  type GraphSnapshot,
} from "./cytoscape-utils";
import { buildLayoutModel } from "./layout-model";

describe("cytoscape-utils", () => {
  it("compoundSizeForContent falls back to minimum compound size", () => {
    expect(compoundSizeForContent(null).w).toBeGreaterThan(0);
    expect(
      compoundSizeForContent({ x1: 0, y1: 0, x2: 200, y2: 100 }).w,
    ).toBeGreaterThan(200);
  });

  it("syncLeafFootprintsFromCy skips missing and compound nodes", () => {
    const cy = cytoscape({
      headless: true,
      style: createCompoundGraphStylesheet(),
      elements: [
        { data: { id: "parent", kind: "container", compoundWidth: 200, compoundHeight: 200 }, position: { x: 0, y: 0 } },
        { data: { id: "child", kind: "leaf", label: "child" }, position: { x: 0, y: 0 } },
      ],
    });
    const model = buildLayoutModel(
      [
        { id: "parent", isCompound: true },
        { id: "child", parent: "parent" },
        { id: "missing", parent: "parent" },
      ],
      {
        parent: { x: 0, y: 0, w: 200, h: 200 },
        child: { x: 0, y: 0 },
        missing: { x: 10, y: 10 },
      },
    );
    syncLeafFootprintsFromCy(cy, model, "parent");
    expect(model.nodes.get("child")?.footprint).toBeDefined();
    expect(model.nodes.get("missing")?.footprint).toBeUndefined();
  });

  it("childFitBoxAbsoluteFromCy returns null for unknown ids", () => {
    const cy = cytoscape({ headless: true, elements: [] });
    const model = buildLayoutModel([], {});
    expect(childFitBoxAbsoluteFromCy(cy, model, "missing")).toBeNull();
  });

  it("applyFrozenCompoundSize skips position shift on first size write", () => {
    const cy = cytoscape({
      headless: true,
      elements: [{ data: { id: "parent", kind: "container" }, position: { x: 5, y: 5 } }],
    });
    const node = cy.getElementById("parent");
    node.position({ x: 5, y: 5 });
    applyFrozenCompoundSize(node, 120, 80);
    expect(node.position()).toEqual({ x: 5, y: 5 });
  });

  it("snapshotDelta ignores children removed in the after snapshot", () => {
    const before: GraphSnapshot = {
      parent: {
        center: { x: 0, y: 0 },
        relative: { x: 0, y: 0 },
        w: 100,
        h: 100,
        box: { x1: -50, y1: -50, x2: 50, y2: 50 },
      },
      children: {
        kept: { absolute: { x: 1, y: 2 }, relative: { x: 1, y: 2 } },
        dropped: { absolute: { x: 3, y: 4 }, relative: { x: 3, y: 4 } },
      },
    };
    const after: GraphSnapshot = {
      ...before,
      children: {
        kept: { absolute: { x: 4, y: 6 }, relative: { x: 4, y: 6 } },
      },
    };
    expect(snapshotDelta(before, after)).toEqual({
      kept: { dx: 3, dy: 4 },
    });
  });
});
