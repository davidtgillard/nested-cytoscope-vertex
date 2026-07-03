import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";
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
});
