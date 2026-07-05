// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TEST_PARENT,
  captureTapstartHandler,
  headlessCy,
  syntheticTapstart,
} from "./helpers/fixtures";

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
