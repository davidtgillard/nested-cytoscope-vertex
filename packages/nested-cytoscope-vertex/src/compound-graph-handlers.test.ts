// @vitest-environment jsdom
import cytoscape, { type EventObject } from "cytoscape";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphParentVertex, createCompoundGraphStylesheet } from "./index";

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

function syntheticTapstart(
  cy: cytoscape.Core,
  childId: string,
  originalEvent: Event,
): EventObject {
  const child = cy.getElementById(childId);
  return {
    target: child,
    originalEvent,
  } as unknown as EventObject;
}

describe("attachChildDragHandlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires onStart, onMove, and onEnd for an owned leaf tapstart", () => {
    const cy = headlessCy(TEST_PARENT.buildElements());
    TEST_PARENT.initializeFromCy(cy);
    const invokeTapstart = captureTapstartHandler(cy);

    const onStart = vi.fn();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    TEST_PARENT.attachChildDragHandlers(cy, { onStart, onMove, onEnd });

    const originalEvent = new MouseEvent("mousedown", { clientX: 100, clientY: 200 });
    invokeTapstart(syntheticTapstart(cy, "child-a", originalEvent));

    expect(onStart).toHaveBeenCalledWith("child-a", expect.objectContaining({ children: expect.any(Object) }));
    expect(TEST_PARENT.isChildDragInProgress()).toBe(true);

    const move = new MouseEvent("mousemove", { clientX: 120, clientY: 220 });
    window.dispatchEvent(move);
    expect(onMove).toHaveBeenCalled();

    const up = new MouseEvent("mouseup", { clientX: 120, clientY: 220 });
    window.dispatchEvent(up);
    expect(onEnd).toHaveBeenCalled();
    expect(TEST_PARENT.isChildDragInProgress()).toBe(false);
  });

  it("ignores tapstart on non-owned leaf nodes", () => {
    const cy = headlessCy([
      ...TEST_PARENT.buildElements(),
      { data: { id: "stranger", kind: "leaf", label: "stranger" }, position: { x: 0, y: 0 } },
    ]);
    TEST_PARENT.initializeFromCy(cy);
    const invokeTapstart = captureTapstartHandler(cy);

    const onStart = vi.fn();
    TEST_PARENT.attachChildDragHandlers(cy, { onStart });

    invokeTapstart(
      syntheticTapstart(cy, "stranger", new MouseEvent("mousedown", { clientX: 0, clientY: 0 })),
    );
    expect(onStart).not.toHaveBeenCalled();
  });

  it("ignores tapstart when a drag is already active", () => {
    type ParentVertexTestApi = {
      beginChildDrag(cy: cytoscape.Core, childId: string): void;
      finishChildDrag(cy: cytoscape.Core): void;
    };
    const parent = TEST_PARENT as typeof TEST_PARENT & ParentVertexTestApi;
    const cy = headlessCy(TEST_PARENT.buildElements());
    TEST_PARENT.initializeFromCy(cy);
    const invokeTapstart = captureTapstartHandler(cy);

    const onStart = vi.fn();
    TEST_PARENT.attachChildDragHandlers(cy, { onStart });

    parent.beginChildDrag(cy, "child-a");
    invokeTapstart(
      syntheticTapstart(cy, "child-b", new MouseEvent("mousedown", { clientX: 0, clientY: 0 })),
    );
    expect(onStart).not.toHaveBeenCalled();
    parent.finishChildDrag(cy);
  });

  it("ignores tapstart when originalEvent has no client point", () => {
    const cy = headlessCy(TEST_PARENT.buildElements());
    TEST_PARENT.initializeFromCy(cy);
    const invokeTapstart = captureTapstartHandler(cy);

    const onStart = vi.fn();
    TEST_PARENT.attachChildDragHandlers(cy, { onStart });

    invokeTapstart(syntheticTapstart(cy, "child-a", new Event("custom")));
    expect(onStart).not.toHaveBeenCalled();
  });

  it("calls preventDefault and stopPropagation when present", () => {
    const cy = headlessCy(TEST_PARENT.buildElements());
    TEST_PARENT.initializeFromCy(cy);
    const invokeTapstart = captureTapstartHandler(cy);
    TEST_PARENT.attachChildDragHandlers(cy, {});

    const originalEvent = new MouseEvent("mousedown", { clientX: 10, clientY: 20 });
    const preventDefault = vi.spyOn(originalEvent, "preventDefault");
    const stopPropagation = vi.spyOn(originalEvent, "stopPropagation");

    invokeTapstart(syntheticTapstart(cy, "child-a", originalEvent));
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();

    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 10, clientY: 20 }));
  });
});
