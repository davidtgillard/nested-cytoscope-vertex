import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";
import { DEMO_COMPOUND } from "./src/lib/compound-graph";
import { COMPOUND_PADDING, CYTOSCAPE_STYLESHEET } from "./src/lib/cytoscape-theme";
import { applyLayoutModelToCy, layoutModelFromCy } from "./src/lib/cytoscape-sync";
import { childrenFitBoxAbsoluteFromCy, compoundAbsolutePosition } from "./src/lib/cytoscape-utils";
import {
  ALL_LOOSE_EDGES,
  buildLayoutModel,
  compositeOuterBox,
  parentOuterBoundsFromChildFit,
  NODE_OVERLAP_PADDING,
  resizeComposite,
  resizeLooseEdgesFromOuter,
} from "./src/lib/layout-model";

describe("toy nested compound resize", () => {
  it("model sync keeps child absolute position on SE resize", () => {
    const cy = cytoscape({
      headless: true,
      style: CYTOSCAPE_STYLESHEET,
      elements: [
        {
          data: { id: "wp-invoicing", kind: "container", compoundWidth: 420, compoundHeight: 280 },
          position: { x: 0, y: 0 },
        },
        {
          data: { id: "wp-pdf-export", kind: "leaf" },
          position: { x: 0, y: 0 },
        },
      ],
    });

    const inputs = [
      { id: "wp-invoicing", isCompound: true },
      { id: "wp-pdf-export", parent: "wp-invoicing" },
    ];
    let model = buildLayoutModel(inputs, {
      "wp-invoicing": { x: 0, y: 0, w: 420, h: 280 },
      "wp-pdf-export": { x: 0, y: 0 },
    });
    applyLayoutModelToCy(cy, model, "model");

    const before = compoundAbsolutePosition(cy.getElementById("wp-pdf-export"));
    model = resizeComposite(model, "wp-invoicing", "se", 80, 60);
    applyLayoutModelToCy(cy, model, "model");
    const after = compoundAbsolutePosition(cy.getElementById("wp-pdf-export"));

    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });

  it("layoutModelFromCy round-trips after resize", () => {
    const cy = cytoscape({
      headless: true,
      style: CYTOSCAPE_STYLESHEET,
      elements: [
        {
          data: { id: "wp-invoicing", kind: "container", compoundWidth: 420, compoundHeight: 280 },
          position: { x: 10, y: 20 },
        },
        {
          data: { id: "wp-pdf-export", kind: "leaf" },
          position: { x: -40, y: 10 },
        },
      ],
    });

    const inputs = [
      { id: "wp-invoicing", isCompound: true },
      { id: "wp-pdf-export", parent: "wp-invoicing" },
    ];
    let model = layoutModelFromCy(cy, inputs);
    model = resizeComposite(model, "wp-invoicing", "nw", -30, -20);
    applyLayoutModelToCy(cy, model, "model");
    const roundTrip = layoutModelFromCy(cy, inputs);
    const child = roundTrip.nodes.get("wp-pdf-export");
    expect(child?.center.x).toBeCloseTo(model.nodes.get("wp-pdf-export")!.center.x, 3);
    expect(child?.center.y).toBeCloseTo(model.nodes.get("wp-pdf-export")!.center.y, 3);
  });

  it("child drag repin keeps parent center stable", () => {
    const cy = cytoscape({
      headless: true,
      style: CYTOSCAPE_STYLESHEET,
      elements: DEMO_COMPOUND.buildElements("preset-sized"),
    });

    const before = DEMO_COMPOUND.initializeFromCy(cy, "preset-sized", true);
    const startAbsolute = compoundAbsolutePosition(cy.getElementById("wp-pdf-export"));
    const draggedDelta = { x: 60, y: 40 };
    const draggedAbsolute = { x: startAbsolute.x + draggedDelta.x, y: startAbsolute.y + draggedDelta.y };

    DEMO_COMPOUND.beginChildDrag(cy);
    cy.getElementById("wp-invoicing").position({ x: 25, y: -15 });
    DEMO_COMPOUND.syncChildDragByDelta(cy, draggedDelta);
    const during = DEMO_COMPOUND.liveSnapshot(cy);

    expect(during.parent.center.x).toBeCloseTo(before.parent.center.x, 3);
    expect(during.parent.center.y).toBeCloseTo(before.parent.center.y, 3);
    expect(during.parent.w).toBeCloseTo(before.parent.w, 3);
    expect(during.parent.h).toBeCloseTo(before.parent.h, 3);
    expect(during.children["wp-pdf-export"].absolute.x).toBeCloseTo(draggedAbsolute.x, 3);
    expect(during.children["wp-pdf-export"].absolute.y).toBeCloseTo(draggedAbsolute.y, 3);

    DEMO_COMPOUND.finishChildDrag(cy);
    const after = DEMO_COMPOUND.snapshot(cy);
    const parentPos = cy.getElementById("wp-invoicing").position();
    const childPos = cy.getElementById("wp-pdf-export").position();

    expect(after.parent.center.x).toBeCloseTo(before.parent.center.x, 3);
    expect(after.parent.center.y).toBeCloseTo(before.parent.center.y, 3);
    expect(after.children["wp-pdf-export"].absolute.x).not.toBeCloseTo(
      before.children["wp-pdf-export"].absolute.x,
      1,
    );
    expect(parentPos.x).toBeCloseTo(before.parent.center.x, 3);
    expect(parentPos.y).toBeCloseTo(before.parent.center.y, 3);
    expect(childPos.x).toBeCloseTo(draggedDelta.x, 3);
    expect(childPos.y).toBeCloseTo(draggedDelta.y, 3);
  });

  it("parent drag sync copies the dragged center into the model", () => {
    const cy = cytoscape({
      headless: true,
      style: CYTOSCAPE_STYLESHEET,
      elements: DEMO_COMPOUND.buildElements("preset-sized"),
    });

    DEMO_COMPOUND.initializeFromCy(cy, "preset-sized", true);
    cy.getElementById("wp-invoicing").position({ x: 55, y: -25 });

    DEMO_COMPOUND.syncParentDragFromCy(cy);

    expect(DEMO_COMPOUND.getModel()?.nodes.get("wp-invoicing")?.center.x).toBeCloseTo(55, 3);
    expect(DEMO_COMPOUND.getModel()?.nodes.get("wp-invoicing")?.center.y).toBeCloseTo(-25, 3);
  });

  it("beginChildDrag keeps current model state instead of importing hidden cy drift", () => {
    const cy = cytoscape({
      headless: true,
      style: CYTOSCAPE_STYLESHEET,
      elements: DEMO_COMPOUND.buildElements("preset-sized"),
    });

    DEMO_COMPOUND.initializeFromCy(cy, "preset-sized", true);

    // Simulate the hidden Cytoscape child drifting away from the authoritative model.
    // Starting a new detached drag should preserve the model state even if the visual
    // drag anchor is taken from the currently visible Cytoscape node position.
    cy.getElementById("wp-pdf-export").position({ x: 70, y: 35 });
    const modelBefore = DEMO_COMPOUND.getModel();
    const expectedAbsolute = modelBefore && {
      x:
        modelBefore.nodes.get("wp-invoicing")!.center.x +
        modelBefore.nodes.get("wp-pdf-export")!.center.x,
      y:
        modelBefore.nodes.get("wp-invoicing")!.center.y +
        modelBefore.nodes.get("wp-pdf-export")!.center.y,
    };

    DEMO_COMPOUND.beginChildDrag(cy);
    const during = DEMO_COMPOUND.liveSnapshot(cy);

    expect(expectedAbsolute).not.toBeNull();
    expect(during.children["wp-pdf-export"].absolute.x).toBeCloseTo(expectedAbsolute!.x, 3);
    expect(during.children["wp-pdf-export"].absolute.y).toBeCloseTo(expectedAbsolute!.y, 3);
  });

  it("SE shrink uses reservedEdge clearance matching child drag bounds", () => {
    const footprint = { halfW: 18, halfHTop: 18, halfHBottom: 26 };
    const reservedEdge = -2;
    const inputs = [
      { id: "parent", isCompound: true },
      { id: "child", parent: "parent", footprint },
    ];
    let model = buildLayoutModel(inputs, {
      parent: { x: 0, y: 0, w: 200, h: 200 },
      child: { x: 50, y: 30 },
    });
    model.nodes.get("parent")!.reservedEdge = reservedEdge;

    const childFitRight = 50 + footprint.halfW;
    const expectedMinRight = childFitRight + reservedEdge;
    const legacyMinRight = childFitRight + NODE_OVERLAP_PADDING + COMPOUND_PADDING.right;

    model = resizeComposite(model, "parent", "se", -1000, 0, {
      childrenBox: {
        x1: 50 - footprint.halfW,
        y1: 30 - footprint.halfHTop,
        x2: 50 + footprint.halfW,
        y2: 30 + footprint.halfHBottom,
      },
      edgeClearance: reservedEdge,
      looseEdges: ALL_LOOSE_EDGES,
    });
    const outer = compositeOuterBox(model, "parent")!;

    expect(outer.x2).toBeCloseTo(expectedMinRight, 3);
    expect(outer.x2).toBeLessThan(legacyMinRight);
  });

  it("SE shrink with live cy child fit box stops at fit plus reservedEdge", () => {
    const cy = cytoscape({
      headless: true,
      style: CYTOSCAPE_STYLESHEET,
      elements: [
        {
          data: { id: "parent", kind: "container", compoundWidth: 240, compoundHeight: 240 },
          position: { x: 0, y: 0 },
        },
        {
          data: {
            id: "child",
            kind: "leaf",
            label: "child",
            color: "#94a3b8",
            nodeWidth: 36,
            nodeHeight: 36,
            labelMarginY: 6,
            labelFontSize: 11,
          },
          position: { x: 40, y: 20 },
        },
      ],
    });

    const inputs = [
      { id: "parent", isCompound: true },
      { id: "child", parent: "parent" },
    ];
    let model = layoutModelFromCy(cy, inputs);
    const reservedEdge = -2;
    model.nodes.get("parent")!.reservedEdge = reservedEdge;
    applyLayoutModelToCy(cy, model, "model");

    const childrenBox = childrenFitBoxAbsoluteFromCy(cy, model, "parent");
    expect(childrenBox).not.toBeNull();

    model = resizeComposite(model, "parent", "se", -1000, 0, {
      childrenBox: childrenBox!,
      edgeClearance: reservedEdge,
      looseEdges: ALL_LOOSE_EDGES,
    });
    const outer = compositeOuterBox(model, "parent")!;

    expect(outer.x2).toBeCloseTo(childrenBox!.x2 + reservedEdge, 2);
  });

  it("SE shrink on preset parent only moves dragged east and south edges", () => {
    const cy = cytoscape({
      headless: true,
      style: CYTOSCAPE_STYLESHEET,
      elements: DEMO_COMPOUND.buildElements("preset-sized"),
    });

    DEMO_COMPOUND.initializeFromCy(cy, "preset-sized", true);
    const reservedEdge = -2;
    DEMO_COMPOUND.setEdgeClearance(reservedEdge);

    const model = DEMO_COMPOUND.getModel()!;
    const startOuter = compositeOuterBox(model, "wp-invoicing")!;
    const childrenBox = childrenFitBoxAbsoluteFromCy(cy, model, "wp-invoicing");
    expect(childrenBox).not.toBeNull();

    const target = parentOuterBoundsFromChildFit(childrenBox!, reservedEdge);
    const resized = resizeComposite(model, "wp-invoicing", "se", -1000, -1000, {
      childrenBox: childrenBox!,
      edgeClearance: reservedEdge,
      looseEdges: ALL_LOOSE_EDGES,
    });
    const outer = compositeOuterBox(resized, "wp-invoicing")!;

    expect(outer.x1).toBeCloseTo(startOuter.x1, 1);
    expect(outer.y1).toBeCloseTo(startOuter.y1, 1);
    expect(outer.x2).toBeCloseTo(target.x2, 1);
    expect(outer.y2).toBeCloseTo(target.y2, 1);
  });

  it("SE drag keeps the opposite NW corner fixed", () => {
    const footprint = { halfW: 18, halfHTop: 18, halfHBottom: 26 };
    const reservedEdge = -2;
    const inputs = [
      { id: "parent", isCompound: true },
      { id: "child", parent: "parent", footprint },
    ];
    const model = buildLayoutModel(inputs, {
      parent: { x: 0, y: 0, w: 420, h: 280 },
      child: { x: 0, y: 0 },
    });
    model.nodes.get("parent")!.reservedEdge = reservedEdge;
    const startOuter = compositeOuterBox(model, "parent")!;
    const constraints = {
      childrenBox: {
        x1: -footprint.halfW,
        y1: -footprint.halfHTop,
        x2: footprint.halfW,
        y2: footprint.halfHBottom,
      },
      edgeClearance: reservedEdge,
      looseEdges: ALL_LOOSE_EDGES,
    };
    const after = resizeComposite(model, "parent", "se", -80, -60, constraints);
    const outer = compositeOuterBox(after, "parent")!;
    expect(outer.x1).toBeCloseTo(startOuter.x1, 6);
    expect(outer.y1).toBeCloseTo(startOuter.y1, 6);
  });

  it("starting a new corner drag does not snap on zero movement", () => {
    const footprint = { halfW: 18, halfHTop: 18, halfHBottom: 26 };
    const reservedEdge = -2;
    const inputs = [
      { id: "parent", isCompound: true },
      { id: "child", parent: "parent", footprint },
    ];
    let model = buildLayoutModel(inputs, {
      parent: { x: 0, y: 0, w: 420, h: 280 },
      child: { x: 0, y: 0 },
    });
    model.nodes.get("parent")!.reservedEdge = reservedEdge;

    const childrenBox = {
      x1: -footprint.halfW,
      y1: -footprint.halfHTop,
      x2: footprint.halfW,
      y2: footprint.halfHBottom,
    };
    const seConstraints = {
      childrenBox,
      edgeClearance: reservedEdge,
      looseEdges: ALL_LOOSE_EDGES,
    };
    model = resizeComposite(model, "parent", "se", -1000, -1000, seConstraints);
    const afterSe = compositeOuterBox(model, "parent")!;

    const nwConstraints = {
      childrenBox,
      edgeClearance: reservedEdge,
      looseEdges: resizeLooseEdgesFromOuter(afterSe, childrenBox, reservedEdge),
    };

    model = resizeComposite(model, "parent", "nw", 0, 0, nwConstraints);
    const outer = compositeOuterBox(model, "parent")!;
    expect(outer.x1).toBeCloseTo(afterSe.x1, 6);
    expect(outer.y1).toBeCloseTo(afterSe.y1, 6);
    expect(outer.x2).toBeCloseTo(afterSe.x2, 6);
    expect(outer.y2).toBeCloseTo(afterSe.y2, 6);
  });

  it("zero drag delta leaves the parent box unchanged even with loose edges", () => {
    const footprint = { halfW: 18, halfHTop: 18, halfHBottom: 26 };
    const reservedEdge = -2;
    const inputs = [
      { id: "parent", isCompound: true },
      { id: "child", parent: "parent", footprint },
    ];
    const model = buildLayoutModel(inputs, {
      parent: { x: 0, y: 0, w: 420, h: 280 },
      child: { x: 0, y: 0 },
    });
    model.nodes.get("parent")!.reservedEdge = reservedEdge;
    const before = compositeOuterBox(model, "parent")!;
    const constraints = {
      childrenBox: {
        x1: -footprint.halfW,
        y1: -footprint.halfHTop,
        x2: footprint.halfW,
        y2: footprint.halfHBottom,
      },
      edgeClearance: reservedEdge,
      looseEdges: ALL_LOOSE_EDGES,
    };
    const after = resizeComposite(model, "parent", "se", 0, 0, constraints);
    const outer = compositeOuterBox(after, "parent")!;
    expect(outer.x1).toBeCloseTo(before.x1, 6);
    expect(outer.y1).toBeCloseTo(before.y1, 6);
    expect(outer.x2).toBeCloseTo(before.x2, 6);
    expect(outer.y2).toBeCloseTo(before.y2, 6);
  });

  it("multi-child resize clamps each edge by the extremal child", () => {
    const footprint = { halfW: 10, halfHTop: 10, halfHBottom: 10 };
    const reservedEdge = 0;
    const inputs = [
      { id: "parent", isCompound: true },
      { id: "child-a", parent: "parent", footprint },
      { id: "child-b", parent: "parent", footprint },
    ];
    const layout = {
      parent: { x: 0, y: 0, w: 400, h: 400 },
      "child-a": { x: -150, y: -150 },
      "child-b": { x: 150, y: 150 },
    };

    let model = buildLayoutModel(inputs, layout);
    model.nodes.get("parent")!.reservedEdge = reservedEdge;

    const expectedMinLeft = -150 - footprint.halfW - reservedEdge;
    const expectedMinTop = -150 - footprint.halfHTop - reservedEdge;
    const expectedMinRight = 150 + footprint.halfW + reservedEdge;
    const expectedMinBottom = 150 + footprint.halfHBottom + reservedEdge;

    model = resizeComposite(model, "parent", "nw", 1000, 1000);
    let outer = compositeOuterBox(model, "parent")!;
    const startOuter = compositeOuterBox(buildLayoutModel(inputs, layout), "parent")!;
    expect(outer.x1).toBeCloseTo(expectedMinLeft, 3);
    expect(outer.y1).toBeCloseTo(expectedMinTop, 3);
    expect(outer.x2).toBeCloseTo(startOuter.x2, 3);
    expect(outer.y2).toBeCloseTo(startOuter.y2, 3);

    model = buildLayoutModel(inputs, layout);
    model.nodes.get("parent")!.reservedEdge = reservedEdge;
    model = resizeComposite(model, "parent", "se", -1000, -1000);
    outer = compositeOuterBox(model, "parent")!;
    expect(outer.x2).toBeCloseTo(expectedMinRight, 3);
    expect(outer.y2).toBeCloseTo(expectedMinBottom, 3);
    expect(outer.x1).toBeCloseTo(startOuter.x1, 3);
    expect(outer.y1).toBeCloseTo(startOuter.y1, 3);
  });
});
