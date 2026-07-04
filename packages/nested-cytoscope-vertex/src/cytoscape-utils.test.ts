import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";
import { createCompoundGraphStylesheet } from "./cytoscape-theme";
import {
  applyFrozenCompoundSize,
  childFitBoxAbsoluteFromCy,
  childrenFitBoxAbsoluteFromCy,
  compoundAbsolutePosition,
  compoundSizeForContent,
  graphNodeModelPosition,
  measureLeafFootprint,
  snapshotDelta,
  snapshotGraphState,
  syncLeafFootprintsFromCy,
  type GraphSnapshot,
} from "./cytoscape-utils";
import { buildLayoutModel, compositeOuterBox } from "./layout-model";

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

  it("applyFrozenCompoundSize skips position shift when size is unchanged", () => {
    const cy = cytoscape({
      headless: true,
      elements: [{ data: { id: "parent", kind: "container", compoundWidth: 120, compoundHeight: 80 } }],
    });
    const node = cy.getElementById("parent");
    node.position({ x: 10, y: 20 });
    applyFrozenCompoundSize(node, 120, 80);
    expect(node.position()).toEqual({ x: 10, y: 20 });
  });

  it("childFitBoxAbsoluteFromCy uses composite outer box for compound children", () => {
    const cy = cytoscape({
      headless: true,
      style: createCompoundGraphStylesheet(),
      elements: [
        { data: { id: "parent", kind: "container", compoundWidth: 200, compoundHeight: 150 }, position: { x: 0, y: 0 } },
        { data: { id: "nested", kind: "container", compoundWidth: 80, compoundHeight: 60 }, position: { x: 10, y: 10 } },
      ],
    });
    const model = buildLayoutModel(
      [
        { id: "parent", isCompound: true },
        { id: "nested", parent: "parent", isCompound: true },
      ],
      {
        parent: { x: 0, y: 0, w: 200, h: 150 },
        nested: { x: 10, y: 10, w: 80, h: 60 },
      },
    );
    expect(childFitBoxAbsoluteFromCy(cy, model, "nested")).toEqual(compositeOuterBox(model, "nested"));
  });

  it("childrenFitBoxAbsoluteFromCy returns null when every child is missing", () => {
    const cy = cytoscape({ headless: true, elements: [] });
    const model = buildLayoutModel(
      [
        { id: "parent", isCompound: true },
        { id: "ghost-a", parent: "parent" },
        { id: "ghost-b", parent: "parent" },
      ],
      {
        parent: { x: 0, y: 0, w: 100, h: 100 },
        "ghost-a": { x: 0, y: 0 },
        "ghost-b": { x: 5, y: 5 },
      },
    );
    expect(childrenFitBoxAbsoluteFromCy(cy, model, "parent")).toBeNull();
  });

  it("childrenFitBoxAbsoluteFromCy merges visible child boxes", () => {
    const cy = cytoscape({
      headless: true,
      style: createCompoundGraphStylesheet(),
      elements: [
        { data: { id: "parent", kind: "container", compoundWidth: 200, compoundHeight: 200 }, position: { x: 0, y: 0 } },
        { data: { id: "left", kind: "leaf", label: "left" }, position: { x: -20, y: 0 } },
        { data: { id: "right", kind: "leaf", label: "right" }, position: { x: 20, y: 0 } },
      ],
    });
    const model = buildLayoutModel(
      [
        { id: "parent", isCompound: true },
        { id: "left", parent: "parent" },
        { id: "right", parent: "parent" },
      ],
      {
        parent: { x: 0, y: 0, w: 200, h: 200 },
        left: { x: -20, y: 0 },
        right: { x: 20, y: 0 },
      },
    );
    const merged = childrenFitBoxAbsoluteFromCy(cy, model, "parent");
    expect(merged).not.toBeNull();
    expect(merged!.x1).toBeLessThan(merged!.x2);
  });

  it("snapshotGraphState captures parent box and child absolutes", () => {
    const cy = cytoscape({
      headless: true,
      style: createCompoundGraphStylesheet(),
      elements: [
        { data: { id: "parent", kind: "container", compoundWidth: 120, compoundHeight: 80 } },
        { data: { id: "child", kind: "leaf", label: "child" } },
      ],
    });
    cy.getElementById("parent").position({ x: 5, y: 6 });
    cy.getElementById("child").position({ x: 10, y: 12 });
    const snap = snapshotGraphState(cy, "parent", ["child"]);
    expect(snap.parent.w).toBe(120);
    expect(snap.parent.box.x1).toBeCloseTo(5 - 60, 3);
    expect(snap.children.child.absolute).toEqual(compoundAbsolutePosition(cy.getElementById("child")));
  });

  it("graphNodeModelPosition and measureLeafFootprint read live node geometry", () => {
    const cy = cytoscape({
      headless: true,
      style: createCompoundGraphStylesheet(),
      elements: [{ data: { id: "leaf", kind: "leaf", label: "leaf" } }],
    });
    const node = cy.getElementById("leaf");
    node.position({ x: 3, y: 4 });
    expect(graphNodeModelPosition(node)).toEqual({ x: 3, y: 4 });
    const footprint = measureLeafFootprint(node);
    expect(footprint.halfW).toBeGreaterThan(0);
    expect(footprint.halfHBottom).toBeGreaterThan(0);
  });
});
