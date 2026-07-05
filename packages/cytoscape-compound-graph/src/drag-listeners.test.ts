// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientPointFromDomEvent,
  clientPointFromOriginalEvent,
  wireDetachedDragListeners,
} from "./drag-listeners";

describe("drag-listeners", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("clientPointFromDomEvent", () => {
    it("reads clientX/clientY from mouse events", () => {
      const event = new MouseEvent("mousedown", { clientX: 12, clientY: 34 });
      expect(clientPointFromDomEvent(event)).toEqual({ clientX: 12, clientY: 34 });
    });

    it("reads clientX/clientY from pointer events", () => {
      const event = new PointerEvent("pointerdown", { clientX: 5, clientY: 6 });
      expect(clientPointFromDomEvent(event)).toEqual({ clientX: 5, clientY: 6 });
    });

    it("reads from touches when present", () => {
      const touch = { clientX: 1, clientY: 2 } as Touch;
      const event = { touches: [touch], changedTouches: [] } as unknown as TouchEvent;
      expect(clientPointFromDomEvent(event)).toEqual({ clientX: 1, clientY: 2 });
    });

    it("falls back to changedTouches", () => {
      const touch = { clientX: 9, clientY: 8 } as Touch;
      const event = { touches: [], changedTouches: [touch] } as unknown as TouchEvent;
      expect(clientPointFromDomEvent(event)).toEqual({ clientX: 9, clientY: 8 });
    });

    it("returns null for unsupported event shapes", () => {
      expect(clientPointFromDomEvent({} as TouchEvent)).toBeNull();
    });

    it("returns null when touch event has no touches", () => {
      const event = { touches: [], changedTouches: [] } as unknown as TouchEvent;
      expect(clientPointFromDomEvent(event)).toBeNull();
    });
  });

  describe("clientPointFromOriginalEvent", () => {
    it("returns null for undefined", () => {
      expect(clientPointFromOriginalEvent(undefined)).toBeNull();
    });

    it("returns null for non-DOM events", () => {
      expect(clientPointFromOriginalEvent(new Event("custom"))).toBeNull();
    });

    it("delegates mouse events to clientPointFromDomEvent", () => {
      const event = new MouseEvent("mousedown", { clientX: 3, clientY: 4 });
      expect(clientPointFromOriginalEvent(event)).toEqual({ clientX: 3, clientY: 4 });
    });
  });

  describe("wireDetachedDragListeners", () => {
    function listenerMap() {
      const map = new Map<string, EventListener>();
      vi.spyOn(window, "addEventListener").mockImplementation((type, listener) => {
        map.set(type, listener as EventListener);
      });
      vi.spyOn(window, "removeEventListener").mockImplementation((type) => {
        map.delete(type);
      });
      return map;
    }

    it("registers window listeners and cleans them up", () => {
      const listeners = listenerMap();
      const onMove = vi.fn();
      const onUp = vi.fn();
      const cleanup = wireDetachedDragListeners(undefined, onMove, onUp);

      expect(listeners.has("pointermove")).toBe(true);
      expect(listeners.has("mousemove")).toBe(true);
      expect(listeners.has("touchmove")).toBe(true);

      cleanup();
      expect(listeners.size).toBe(0);
    });

    it("forwards mouse move and up events", () => {
      const listeners = listenerMap();
      const onMove = vi.fn();
      const onUp = vi.fn();
      wireDetachedDragListeners(undefined, onMove, onUp);

      const move = new MouseEvent("mousemove", { clientX: 1, clientY: 2 });
      listeners.get("mousemove")!(move);
      expect(onMove).toHaveBeenCalledWith(move);

      const up = new MouseEvent("mouseup", { clientX: 1, clientY: 2 });
      listeners.get("mouseup")!(up);
      expect(onUp).toHaveBeenCalledWith(up);

      listeners.get("mousemove")!(new MouseEvent("mousemove"));
      expect(onMove).toHaveBeenCalledTimes(1);
    });

    it("forwards touch move and up events", () => {
      const listeners = listenerMap();
      const onMove = vi.fn();
      const onUp = vi.fn();
      wireDetachedDragListeners(undefined, onMove, onUp);

      const touch = { clientX: 4, clientY: 5 } as Touch;
      const move = { touches: [touch], changedTouches: [], preventDefault: vi.fn() } as unknown as TouchEvent;
      listeners.get("touchmove")!(move);
      expect(onMove).toHaveBeenCalledWith(move);

      const up = { touches: [], changedTouches: [touch], preventDefault: vi.fn() } as unknown as TouchEvent;
      listeners.get("touchend")!(up);
      expect(onUp).toHaveBeenCalledWith(up);
    });

    it("ignores a second touch end after the drag already ended", () => {
      const listeners = listenerMap();
      const onMove = vi.fn();
      const onUp = vi.fn();
      wireDetachedDragListeners(undefined, onMove, onUp);

      const touch = { clientX: 1, clientY: 2 } as Touch;
      const up = {
        touches: [],
        changedTouches: [touch],
        preventDefault: vi.fn(),
      } as unknown as TouchEvent;
      listeners.get("touchend")!(up);
      listeners.get("touchend")!(up);

      expect(onUp).toHaveBeenCalledTimes(1);
    });

    it("ignores pointer events with a mismatched pointerId", () => {
      const listeners = listenerMap();
      const onMove = vi.fn();
      const onUp = vi.fn();
      const target = document.createElement("div");
      const start = new PointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
      Object.defineProperty(start, "target", { value: target });
      wireDetachedDragListeners(start, onMove, onUp);

      const other = new PointerEvent("pointermove", { pointerId: 2, clientX: 1, clientY: 1 });
      listeners.get("pointermove")!(other);
      expect(onMove).not.toHaveBeenCalled();

      const match = new PointerEvent("pointermove", { pointerId: 1, clientX: 2, clientY: 2 });
      listeners.get("pointermove")!(match);
      expect(onMove).toHaveBeenCalledWith(match);

      const wrongUp = new PointerEvent("pointerup", { pointerId: 2 });
      listeners.get("pointerup")!(wrongUp);
      expect(onUp).not.toHaveBeenCalled();

      const goodUp = new PointerEvent("pointerup", { pointerId: 1 });
      listeners.get("pointerup")!(goodUp);
      expect(onUp).toHaveBeenCalledWith(goodUp);
    });

    it("captures and releases pointer on the start target", () => {
      const listeners = listenerMap();
      const target = document.createElement("div");
      const setCapture = vi.fn();
      const releaseCapture = vi.fn();
      Object.assign(target, { setPointerCapture: setCapture, releasePointerCapture: releaseCapture });

      const start = new PointerEvent("pointerdown", { pointerId: 7, clientX: 0, clientY: 0 });
      Object.defineProperty(start, "target", { value: target });

      const cleanup = wireDetachedDragListeners(start, vi.fn(), vi.fn());
      expect(setCapture).toHaveBeenCalledWith(7);

      cleanup();
      expect(releaseCapture).toHaveBeenCalledWith(7);
    });

    it("ignores pointer capture failures", () => {
      const listeners = listenerMap();
      const target = document.createElement("div");
      Object.assign(target, {
        setPointerCapture: () => {
          throw new Error("capture failed");
        },
        releasePointerCapture: () => {
          throw new Error("release failed");
        },
      });

      const start = new PointerEvent("pointerdown", { pointerId: 3, clientX: 0, clientY: 0 });
      Object.defineProperty(start, "target", { value: target });

      const cleanup = wireDetachedDragListeners(start, vi.fn(), vi.fn());
      expect(() => cleanup()).not.toThrow();
    });

    it("routes pointercancel through the up handler", () => {
      const listeners = listenerMap();
      const onUp = vi.fn();
      wireDetachedDragListeners(undefined, vi.fn(), onUp);

      const cancel = new PointerEvent("pointercancel", { pointerId: 0 });
      listeners.get("pointercancel")!(cancel);
      expect(onUp).toHaveBeenCalledWith(cancel);
    });

    it("ignores move and up events after cleanup", () => {
      const listeners = listenerMap();
      const onMove = vi.fn();
      const onUp = vi.fn();
      const start = new PointerEvent("pointerdown", { pointerId: 4, clientX: 0, clientY: 0 });
      const cleanup = wireDetachedDragListeners(start, onMove, onUp);
      const pointerMove = listeners.get("pointermove");
      const pointerUp = listeners.get("pointerup");
      const touchMove = listeners.get("touchmove");
      const mouseUp = listeners.get("mouseup");
      cleanup();

      pointerMove!(new PointerEvent("pointermove", { pointerId: 4 }));
      pointerUp!(new PointerEvent("pointerup", { pointerId: 4 }));
      touchMove!({ touches: [{ clientX: 1, clientY: 2 } as Touch], changedTouches: [], preventDefault: vi.fn() } as unknown as TouchEvent);
      mouseUp!(new MouseEvent("mouseup"));
      expect(onMove).not.toHaveBeenCalled();
      expect(onUp).not.toHaveBeenCalled();
    });
  });
});
