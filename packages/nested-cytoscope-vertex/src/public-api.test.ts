import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPOUND_GRAPH_THEME,
  GraphParentVertex,
  createCompoundGraphStylesheet,
  leafDomVisualStyle,
  snapshotDelta,
} from "./index";

const TEST_PARENT = GraphParentVertex.create({
  id: "parent",
  label: "parent",
  color: "#64748b",
  children: [
    { id: "child-a", label: "child-a", color: "#94a3b8", x: -40, y: 0 },
    { id: "child-b", label: "child-b", color: "#a8b4c4", x: 40, y: 0 },
  ],
});

function headlessCy(elements: cytoscape.ElementDefinition[]) {
  return cytoscape({
    headless: true,
    style: createCompoundGraphStylesheet(),
    elements,
  });
}

describe("public API", () => {
  it("createCompoundGraphStylesheet accepts partial theme overrides", () => {
    const sheet = createCompoundGraphStylesheet({
      leafLabel: { color: "#ff0000" },
    });
    expect(sheet.length).toBeGreaterThan(0);
  });

  it("leafDomVisualStyle reflects theme defaults and overrides", () => {
    const defaults = leafDomVisualStyle();
    expect(defaults.fontSize).toBe(DEFAULT_COMPOUND_GRAPH_THEME.leafLabel.fontSize);
    const custom = leafDomVisualStyle({ leafNode: { diameter: 48 } });
    expect(custom.nodeWidth).toBe(48);
  });

  it("initializeFromCy returns a snapshot with child absolutes", () => {
    const cy = headlessCy(TEST_PARENT.buildElements());

    const snap = TEST_PARENT.initializeFromCy(cy);
    expect(snap.children["child-a"].absolute).toBeDefined();
    expect(snap.parent.w).toBeGreaterThan(0);
    expect(snap.parent.h).toBeGreaterThan(0);
  });

  it("visual helpers and debug snapshot work after initialization", () => {
    const cy = headlessCy(TEST_PARENT.buildElements());
    TEST_PARENT.initializeFromCy(cy);
    cy.getElementById("parent").select();

    expect(TEST_PARENT.renderedHandleBox(cy)).not.toBeNull();
    expect(TEST_PARENT.parentDragVisual(cy)).not.toBeNull();
    expect(TEST_PARENT.minResizeVisual(cy)).not.toBeNull();
    expect(TEST_PARENT.modelDebugSnapshot()).toContain("parent");
    expect(TEST_PARENT.getChild("child-a")?.label).toBe("child-a");
  });

  it("attachParentDragHandlers fires onChange when parent moves", () => {
    const cy = headlessCy(TEST_PARENT.buildElements());
    TEST_PARENT.initializeFromCy(cy);
    let changed = false;
    TEST_PARENT.attachParentDragHandlers(cy, { onChange: () => { changed = true; } });

    const parent = cy.getElementById("parent");
    parent.trigger("grab");
    parent.position({ x: 42, y: -18 });
    parent.trigger("drag");
    parent.trigger("free");

    expect(changed).toBe(true);
    expect(TEST_PARENT.getModel()?.nodes.get("parent")?.center.x).toBeCloseTo(42, 2);
  });

  it("liveSnapshot differs from snapshot during child drag", () => {
    type ParentVertexTestApi = {
      beginChildDrag(cy: cytoscape.Core, childId: string): void;
      syncChildDragByDelta(cy: cytoscape.Core, childId: string, delta: { x: number; y: number }): void;
      finishChildDrag(cy: cytoscape.Core): void;
    };
    const parent = TEST_PARENT as typeof TEST_PARENT & ParentVertexTestApi;
    const cy = headlessCy(TEST_PARENT.buildElements());
    TEST_PARENT.initializeFromCy(cy);

    parent.beginChildDrag(cy, "child-a");
    parent.syncChildDragByDelta(cy, "child-a", { x: 20, y: 10 });
    const live = TEST_PARENT.liveSnapshot(cy);
    const snap = TEST_PARENT.snapshot(cy);
    expect(live.children["child-a"].absolute.x).not.toBeCloseTo(
      snap.children["child-a"].absolute.x,
      0,
    );
    parent.finishChildDrag(cy);
    expect(TEST_PARENT.childDragVisual(cy)).toBeNull();
  });

  it("SE resize through GraphParentVertex preserves child absolutes", () => {
    const cy = headlessCy(TEST_PARENT.buildElements());

    TEST_PARENT.initializeFromCy(cy);
    TEST_PARENT.setEdgeClearance(0);

    const beforeA = cy.getElementById("child-a").position();
    const beforeB = cy.getElementById("child-b").position();

    const constraints = TEST_PARENT.computeResizeChildConstraints(cy);
    const startModel = TEST_PARENT.cloneModel();
    TEST_PARENT.resizeFromCorner("se", 40, 30, startModel, constraints);
    TEST_PARENT.syncToCy(cy);

    const afterA = cy.getElementById("child-a").position();
    const afterB = cy.getElementById("child-b").position();

    expect(afterA.x).toBeCloseTo(beforeA.x, 2);
    expect(afterA.y).toBeCloseTo(beforeA.y, 2);
    expect(afterB.x).toBeCloseTo(beforeB.x, 2);
    expect(afterB.y).toBeCloseTo(beforeB.y, 2);
  });

  it("attachParentDragHandlers ignores gestures during child drag", () => {
    type ParentVertexTestApi = {
      beginChildDrag(cy: cytoscape.Core, childId: string): void;
      finishChildDrag(cy: cytoscape.Core): void;
    };
    const parent = TEST_PARENT as typeof TEST_PARENT & ParentVertexTestApi;
    const cy = headlessCy(TEST_PARENT.buildElements());
    TEST_PARENT.initializeFromCy(cy);
    let changed = false;
    TEST_PARENT.attachParentDragHandlers(cy, { onChange: () => { changed = true; } });

    parent.beginChildDrag(cy, "child-a");
    const node = cy.getElementById("parent");
    node.trigger("grab");
    node.position({ x: 80, y: 20 });
    node.trigger("drag");
    node.trigger("free");
    parent.finishChildDrag(cy);

    expect(changed).toBe(false);
  });

  it("getChild returns undefined for unknown ids", () => {
    expect(TEST_PARENT.getChild("missing")).toBeUndefined();
  });

  it("computeResizeChildConstraints handles empty compounds", () => {
    const empty = GraphParentVertex.create({
      id: "empty",
      label: "empty",
      color: "#000",
      children: [],
    });
    const cy = headlessCy(empty.buildElements());
    empty.initializeFromCy(cy);
    const constraints = empty.computeResizeChildConstraints(cy);
    expect(constraints.childrenBox).toBeNull();
    expect(constraints.looseEdges).toEqual({
      west: false,
      east: false,
      north: false,
      south: false,
    });
  });

  it("renderedHandleBox is null when the parent is not selected", () => {
    const cy = headlessCy(TEST_PARENT.buildElements());
    TEST_PARENT.initializeFromCy(cy);
    expect(TEST_PARENT.renderedHandleBox(cy)).toBeNull();
  });

  it("cloneModel throws before initialization", () => {
    const fresh = GraphParentVertex.create({
      id: "fresh",
      label: "fresh",
      color: "#000",
      children: [{ id: "c", label: "c", color: "#111" }],
    });
    expect(() => fresh.cloneModel()).toThrow();
  });

  it("syncToCy is a no-op before the model exists", () => {
    const fresh = GraphParentVertex.create({
      id: "solo",
      label: "solo",
      color: "#000",
      children: [{ id: "c", label: "c", color: "#111" }],
    });
    const cy = headlessCy(fresh.buildElements());
    fresh.syncToCy(cy);
    expect(fresh.getModel()).toBeNull();
  });

  it("snapshotDelta reports zero drift when parent resizes", () => {
    const cy = headlessCy(TEST_PARENT.buildElements());

    TEST_PARENT.initializeFromCy(cy);
    const baseline = TEST_PARENT.snapshot(cy);

    const constraints = TEST_PARENT.computeResizeChildConstraints(cy);
    TEST_PARENT.resizeFromCorner("se", 50, 40, TEST_PARENT.cloneModel(), constraints);
    TEST_PARENT.syncToCy(cy);

    const live = TEST_PARENT.snapshot(cy);
    const deltas = snapshotDelta(baseline, live);

    for (const delta of Object.values(deltas)) {
      expect(Math.hypot(delta.dx, delta.dy)).toBeLessThan(0.5);
    }
  });
});
