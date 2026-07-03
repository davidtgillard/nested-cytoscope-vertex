import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";
import { DEMO_COMPOUND } from "./src/lib/compound-graph";
import { CYTOSCAPE_STYLESHEET } from "./src/lib/cytoscape-theme";
import { applyLayoutModelToCy, layoutModelFromCy } from "./src/lib/cytoscape-sync";
import { compoundAbsolutePosition } from "./src/lib/cytoscape-utils";
import { buildLayoutModel, resizeComposite } from "./src/lib/layout-model";

describe("toy nested compound resize", () => {
  it("model sync keeps child absolute position on SE resize", () => {
    const cy = cytoscape({
      headless: true,
      style: CYTOSCAPE_STYLESHEET,
      elements: [
        {
          data: { id: "wp-invoicing", compoundWidth: 420, compoundHeight: 280 },
          position: { x: 0, y: 0 },
        },
        {
          data: { id: "wp-pdf-export", parent: "wp-invoicing" },
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
          data: { id: "wp-invoicing", compoundWidth: 420, compoundHeight: 280 },
          position: { x: 10, y: 20 },
        },
        {
          data: { id: "wp-pdf-export", parent: "wp-invoicing" },
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
    DEMO_COMPOUND.syncChildDragByDelta(draggedDelta);
    const during = DEMO_COMPOUND.liveSnapshot(cy);

    expect(during.parent.center.x).toBeCloseTo(before.parent.center.x, 3);
    expect(during.parent.center.y).toBeCloseTo(before.parent.center.y, 3);
    expect(during.parent.w).toBeCloseTo(before.parent.w, 3);
    expect(during.parent.h).toBeCloseTo(before.parent.h, 3);
    expect(during.children["wp-pdf-export"].absolute.x).toBeCloseTo(draggedAbsolute.x, 3);
    expect(during.children["wp-pdf-export"].absolute.y).toBeCloseTo(draggedAbsolute.y, 3);

    DEMO_COMPOUND.finishChildDrag(cy);
    const after = DEMO_COMPOUND.snapshot(cy);

    expect(after.parent.center.x).toBeCloseTo(before.parent.center.x, 3);
    expect(after.parent.center.y).toBeCloseTo(before.parent.center.y, 3);
    expect(after.children["wp-pdf-export"].absolute.x).not.toBeCloseTo(
      before.children["wp-pdf-export"].absolute.x,
      1,
    );
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

  it("beginChildDrag resyncs from Cytoscape before showing the drag ghost", () => {
    const cy = cytoscape({
      headless: true,
      style: CYTOSCAPE_STYLESHEET,
      elements: DEMO_COMPOUND.buildElements("preset-sized"),
    });

    DEMO_COMPOUND.initializeFromCy(cy, "preset-sized", true);

    // Simulate the scene moving ahead of the cached model; the detached drag should
    // still start from the node's real Cytoscape position rather than the stale model.
    cy.getElementById("wp-pdf-export").position({ x: 70, y: 35 });
    const childAbsolute = compoundAbsolutePosition(cy.getElementById("wp-pdf-export"));

    DEMO_COMPOUND.beginChildDrag(cy);
    const during = DEMO_COMPOUND.liveSnapshot(cy);
    const visual = DEMO_COMPOUND.childDragVisual(cy);

    expect(during.children["wp-pdf-export"].absolute.x).toBeCloseTo(childAbsolute.x, 3);
    expect(during.children["wp-pdf-export"].absolute.y).toBeCloseTo(childAbsolute.y, 3);
    expect(visual?.renderedX).toBeCloseTo(cy.getElementById("wp-pdf-export").renderedPosition().x, 3);
    expect(visual?.renderedY).toBeCloseTo(cy.getElementById("wp-pdf-export").renderedPosition().y, 3);
  });
});
