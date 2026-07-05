// @vitest-environment jsdom
import cytoscape, { type EventObject } from "cytoscape";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphParentVertex } from "@dgillard/cytoscape-compound-graph";
import {
  captureTapstartHandler,
  headlessCy,
} from "./helpers/fixtures";

describe("compound-graph branches", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializeFromCy measures an unsized parent around its children", () => {
    const parent = GraphParentVertex.create({
      id: "measured",
      label: "measured",
      color: "#000",
      children: [{ id: "solo", label: "solo", color: "#111", x: 10, y: 5 }],
    });
    const cy = headlessCy(parent.buildElements());
    const snap = parent.initializeFromCy(cy);
    expect(snap.parent.w).toBeGreaterThan(0);
    expect(snap.parent.h).toBeGreaterThan(0);
    expect(cy.getElementById("measured").data("compoundWidth")).toBeGreaterThan(0);
  });

  it("attachParentDragHandlers onFree without drag does not call onChange", () => {
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    let changed = false;
    parent.attachParentDragHandlers(cy, { onChange: () => { changed = true; } });
    cy.getElementById("parent").trigger("grab");
    cy.getElementById("parent").trigger("free");
    expect(changed).toBe(false);
  });

  it("renderedHandleBox returns null when the parent node is missing", () => {
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    cy.getElementById("parent").select();
    cy.getElementById("parent").remove();
    expect(parent.renderedHandleBox(cy)).toBeNull();
  });

  it("syncToCy tolerates a missing parent element in cy", () => {
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    cy.getElementById("parent").remove();
    expect(() => parent.syncToCy(cy)).not.toThrow();
  });

  it("attachChildDragHandlers ignores move events without client coordinates", () => {
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    const invokeTapstart = captureTapstartHandler(cy);
    const onMove = vi.fn();
    parent.attachChildDragHandlers(cy, { onMove });

    invokeTapstart({
      target: cy.getElementById("child"),
      originalEvent: new MouseEvent("mousedown", { clientX: 10, clientY: 10 }),
    } as unknown as EventObject);

    window.dispatchEvent(new TouchEvent("touchmove", { touches: [], changedTouches: [] }));
    expect(onMove).not.toHaveBeenCalled();

    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 10, clientY: 10 }));
  });

  it("GraphChildVertex exposes absoluteCenter through the layout model", () => {
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111", x: 4, y: 6 }],
    });
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    const child = parent.getChild("child");
    const model = parent.getModel()!;
    expect(child?.absoluteCenter(model)).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  });

  it("parentDragVisual returns null when the layout model is absent", () => {
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const cy = headlessCy(parent.buildElements());
    expect(parent.parentDragVisual(cy)).toBeNull();
  });

  it("parentDragVisual reports selected state from cy", () => {
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    cy.getElementById("parent").select();
    expect(parent.parentDragVisual(cy)?.selected).toBe(true);
  });

  it("computeResizeChildConstraints uses padding when zoom is zero", () => {
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    vi.spyOn(cy, "zoom").mockImplementation(((...args: unknown[]) => {
      if (args.length > 0) {
        return cy;
      }
      return 0;
    }) as typeof cy.zoom);
    const constraints = parent.computeResizeChildConstraints(cy);
    expect(constraints.edgeClearance).toBeGreaterThan(0);
  });
});
