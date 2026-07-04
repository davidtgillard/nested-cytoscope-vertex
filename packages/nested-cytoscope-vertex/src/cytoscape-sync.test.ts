import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";
import { createCompoundGraphStylesheet } from "./cytoscape-theme";
import { applyLayoutModelToCy, layoutModelFromCy } from "./cytoscape-sync";
import { buildLayoutModel, resizeComposite } from "./layout-model";

describe("cytoscape-sync", () => {
  it("layoutModelFromCy preserves missing elements from inputs", () => {
    const cy = cytoscape({
      headless: true,
      style: createCompoundGraphStylesheet(),
      elements: [
        { data: { id: "parent", kind: "container", compoundWidth: 180, compoundHeight: 120 }, position: { x: 0, y: 0 } },
      ],
    });
    const model = layoutModelFromCy(cy, [
      { id: "parent", isCompound: true },
      { id: "missing-child", parent: "parent" },
    ]);
    expect(model.nodes.has("missing-child")).toBe(true);
  });

  it("applyLayoutModelToCy writes compound sizes before descendant positions", () => {
    const cy = cytoscape({
      headless: true,
      style: createCompoundGraphStylesheet(),
      elements: [
        { data: { id: "parent", kind: "container" }, position: { x: 0, y: 0 } },
        { data: { id: "child", kind: "leaf", label: "child" }, position: { x: 0, y: 0 } },
      ],
    });
    let model = buildLayoutModel(
      [
        { id: "parent", isCompound: true },
        { id: "child", parent: "parent" },
      ],
      {
        parent: { x: 0, y: 0, w: 220, h: 160 },
        child: { x: 10, y: 5 },
      },
    );
    model = resizeComposite(model, "parent", "se", 20, 10);
    applyLayoutModelToCy(cy, model);
    expect(Number(cy.getElementById("parent").data("compoundWidth"))).toBeGreaterThan(220);
    expect(cy.getElementById("child").position().x).not.toBe(0);
  });
});
