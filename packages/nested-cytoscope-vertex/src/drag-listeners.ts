/** Client coordinates from a DOM pointer/mouse/touch event. */
export function clientPointFromDomEvent(
  event: MouseEvent | PointerEvent | TouchEvent,
): { clientX: number; clientY: number } | null {
  if ("clientX" in event && "clientY" in event) {
    return { clientX: event.clientX, clientY: event.clientY };
  }
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) {
    return null;
  }
  return { clientX: touch.clientX, clientY: touch.clientY };
}

/** Client coordinates from a Cytoscape `originalEvent`, when it is a DOM event. */
export function clientPointFromOriginalEvent(
  originalEvent: Event | undefined,
): { clientX: number; clientY: number } | null {
  if (!originalEvent) {
    return null;
  }
  if (
    originalEvent instanceof MouseEvent ||
    originalEvent instanceof PointerEvent ||
    originalEvent instanceof TouchEvent
  ) {
    return clientPointFromDomEvent(originalEvent);
  }
  return null;
}

/**
 * Window-level move/up listeners for a drag that started on a Cytoscape node.
 * Returns cleanup that removes listeners and releases pointer capture when possible.
 */
export function wireDetachedDragListeners(
  originalEvent: Event | undefined,
  onMove: (event: MouseEvent | PointerEvent | TouchEvent) => void,
  onUp: (event: MouseEvent | PointerEvent | TouchEvent) => void,
): () => void {
  const pointerStartEvent = originalEvent instanceof PointerEvent ? originalEvent : null;
  let active = true;
  const pointerTarget =
    pointerStartEvent && pointerStartEvent.target instanceof Element
      ? pointerStartEvent.target
      : null;

  if (pointerStartEvent && pointerTarget && "setPointerCapture" in pointerTarget) {
    try {
      pointerTarget.setPointerCapture(pointerStartEvent.pointerId);
    } catch {
      // Ignore capture failures; the window listeners below are the real fallback.
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!active) {
      return;
    }
    if (pointerStartEvent && event.pointerId !== pointerStartEvent.pointerId) {
      return;
    }
    onMove(event);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!active) {
      return;
    }
    if (pointerStartEvent && event.pointerId !== pointerStartEvent.pointerId) {
      return;
    }
    active = false;
    onUp(event);
  };
  const onMouseMove = (event: MouseEvent) => {
    if (!active) {
      return;
    }
    onMove(event);
  };
  const onMouseUp = (event: MouseEvent) => {
    if (!active) {
      return;
    }
    active = false;
    onUp(event);
  };
  const onTouchMove = (event: TouchEvent) => {
    if (!active) {
      return;
    }
    onMove(event);
  };
  const onTouchUp = (event: TouchEvent) => {
    if (!active) {
      return;
    }
    active = false;
    onUp(event);
  };

  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  window.addEventListener("touchend", onTouchUp, { capture: true, passive: false });
  window.addEventListener("touchcancel", onTouchUp, { capture: true, passive: false });
  return () => {
    active = false;
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerUp, true);
    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("mouseup", onMouseUp, true);
    window.removeEventListener("touchmove", onTouchMove, true);
    window.removeEventListener("touchend", onTouchUp, true);
    window.removeEventListener("touchcancel", onTouchUp, true);
    if (pointerTarget && pointerStartEvent && "releasePointerCapture" in pointerTarget) {
      try {
        pointerTarget.releasePointerCapture(pointerStartEvent.pointerId);
      } catch {
        // Ignore release failures during cleanup.
      }
    }
  };
}
