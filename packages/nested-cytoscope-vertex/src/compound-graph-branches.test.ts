// @vitest-environment jsdom
import cytoscape, { type EventObject } from "cytoscape";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphParentVertex, createCompoundGraphStylesheet } from "./index";

function headlessCy(elements: cytoscape.ElementDefinition[]) {
  return cytoscape({
    headless: true,
    style: createCompoundGraphStylesheet(),
    elements,
  });
}

function captureTapstartHandler(cy: cytoscape.Core): (event: EventObject) => void {
  let handler: ((event: EventObject) => void) | undefined;
  const realOn = cy.on.bind(cy);
  vi.spyOn(cy, "on").mockImplementation((eventName, selector, fn) => {
    if (eventName === "tapstart" && typeof selector === "string" && typeof fn === "function") {
      handler = fn as (event: EventObject) => void;
    }
    return realOn(eventName, selector, fn);
  });
  return (event) => {
    if (!handler) {
      throw new Error("tapstart handler was not registered");
    }
    handler(event);
  };
}

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

  it("finishChildDrag recovers when the model was cleared mid-gesture", () => {
    type ParentVertexInternals = {
      beginChildDrag(cy: cytoscape.Core, childId: string): void;
      finishChildDrag(cy: cytoscape.Core): void;
      childDragActive: boolean;
      childDragSession: unknown;
      model: unknown;
    };
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const internal = parent as typeof parent & ParentVertexInternals;
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    internal.beginChildDrag(cy, "child");
    internal.model = null;
    expect(() => internal.finishChildDrag(cy)).not.toThrow();
    expect(internal.childDragActive).toBe(false);
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

  it("childDragVisual returns null when the session child is unknown", () => {
    type ParentVertexInternals = {
      beginChildDrag(cy: cytoscape.Core, childId: string): void;
      childDragSession: { childId: string } | null;
    };
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const internal = parent as typeof parent & ParentVertexInternals;
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    internal.beginChildDrag(cy, "child");
    internal.childDragSession = { childId: "missing" } as ParentVertexInternals["childDragSession"];
    expect(parent.childDragVisual(cy)).toBeNull();
    (parent as ParentVertexInternals & { finishChildDrag(cy: cytoscape.Core): void }).finishChildDrag(cy);
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

  it("beginChildDrag ignores duplicate and missing-element starts", () => {
    type ParentVertexInternals = {
      beginChildDrag(cy: cytoscape.Core, childId: string): void;
      finishChildDrag(cy: cytoscape.Core): void;
      syncChildDragByDelta(cy: cytoscape.Core, childId: string, delta: { x: number; y: number }): void;
    };
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const internal = parent as typeof parent & ParentVertexInternals;
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    internal.beginChildDrag(cy, "child");
    internal.beginChildDrag(cy, "child");
    internal.finishChildDrag(cy);

    cy.getElementById("child").remove();
    internal.beginChildDrag(cy, "child");
    expect(parent.isChildDragInProgress()).toBe(false);

    cy.getElementById("parent").remove();
    internal.beginChildDrag(cy, "child");
    expect(parent.isChildDragInProgress()).toBe(false);
  });

  it("syncChildDragByDelta ignores stale child ids", () => {
    type ParentVertexInternals = {
      beginChildDrag(cy: cytoscape.Core, childId: string): void;
      finishChildDrag(cy: cytoscape.Core): void;
      syncChildDragByDelta(cy: cytoscape.Core, childId: string, delta: { x: number; y: number }): void;
    };
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const internal = parent as typeof parent & ParentVertexInternals;
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    internal.beginChildDrag(cy, "child");
    const before = parent.getModel()?.nodes.get("child")?.center;
    internal.syncChildDragByDelta(cy, "other", { x: 50, y: 50 });
    expect(parent.getModel()?.nodes.get("child")?.center).toEqual(before);
    internal.finishChildDrag(cy);
  });

  it("syncParentDragFromCy no-ops when the parent element is missing", () => {
    type ParentVertexInternals = {
      syncParentDragFromCy(cy: cytoscape.Core): void;
    };
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const internal = parent as typeof parent & ParentVertexInternals;
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    const before = parent.getModel()?.nodes.get("parent")?.center;
    cy.getElementById("parent").remove();
    internal.syncParentDragFromCy(cy);
    expect(parent.getModel()?.nodes.get("parent")?.center).toEqual(before);
  });

  it("liveSnapshot falls back when drag session data is incomplete", () => {
    type ParentVertexInternals = {
      beginChildDrag(cy: cytoscape.Core, childId: string): void;
      finishChildDrag(cy: cytoscape.Core): void;
      childDragSession: { childId: string } | null;
    };
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const internal = parent as typeof parent & ParentVertexInternals;
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    internal.beginChildDrag(cy, "child");
    parent.getModel()!.nodes.get("parent")!.size = undefined;
    expect(parent.liveSnapshot(cy)).toEqual(parent.snapshot(cy));
    internal.finishChildDrag(cy);
  });

  it("beginChildDrag aborts when the parent element is missing from cy", () => {
    type ParentVertexInternals = {
      beginChildDrag(cy: cytoscape.Core, childId: string): void;
    };
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const internal = parent as typeof parent & ParentVertexInternals;
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    cy.getElementById("parent").remove();
    internal.beginChildDrag(cy, "child");
    expect(parent.isChildDragInProgress()).toBe(false);
  });

  it("syncParentDragFromCy skips child elements that are missing from cy", () => {
    type ParentVertexInternals = {
      syncParentDragFromCy(cy: cytoscape.Core): void;
    };
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const internal = parent as typeof parent & ParentVertexInternals;
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    cy.getElementById("child").remove();
    cy.getElementById("parent").position({ x: 25, y: 15 });
    internal.syncParentDragFromCy(cy);
    expect(parent.getModel()?.nodes.get("parent")?.center.x).toBeCloseTo(25, 2);
  });

  it("measureFromCy skips child elements that are missing from cy", () => {
    type ParentVertexInternals = {
      measureFromCy(cy: cytoscape.Core): void;
    };
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [
        { id: "present", label: "present", color: "#111", x: 0, y: 0 },
        { id: "absent", label: "absent", color: "#222", x: 20, y: 0 },
      ],
    });
    const internal = parent as typeof parent & ParentVertexInternals;
    const elements = parent.buildElements().filter((element) => element.data?.id !== "absent");
    const cy = headlessCy(elements);
    expect(() => internal.measureFromCy(cy)).not.toThrow();
    expect(cy.getElementById("parent").data("compoundWidth")).toBeGreaterThan(0);
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
    vi.spyOn(cy, "zoom").mockReturnValue(0);
    const constraints = parent.computeResizeChildConstraints(cy);
    expect(constraints.edgeClearance).toBeGreaterThan(0);
  });

  it("renderedHandleBox returns null when the parent has no compound size in the model", () => {
    type ParentVertexInternals = {
      model: NonNullable<ReturnType<GraphParentVertex["getModel"]>>;
    };
    const parent = GraphParentVertex.create({
      id: "parent",
      label: "parent",
      color: "#000",
      children: [{ id: "child", label: "child", color: "#111" }],
    });
    const cy = headlessCy(parent.buildElements());
    parent.initializeFromCy(cy);
    cy.getElementById("parent").select();
    const internal = parent as typeof parent & ParentVertexInternals;
    internal.model = parent.getModel();
    internal.model!.nodes.get("parent")!.size = undefined;
    expect(parent.renderedHandleBox(cy)).toBeNull();
  });
});
