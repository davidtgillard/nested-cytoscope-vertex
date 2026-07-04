import { type Core, type EventObject } from "cytoscape";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { type SyncMode } from "./lib/cytoscape-sync";
import { snapshotDelta, type GraphSnapshot } from "./lib/cytoscape-utils";
import {
  type ChildDragVisual,
  createDemoCy,
  DEMO_COMPOUND,
  type ParentDragVisual,
  type Scenario,
} from "./lib/compound-graph";
import { type ResizeCorner } from "./lib/layout-model";

type ResizeTiming = "live" | "deferred";

const SYNC_MODES: { id: SyncMode; label: string }[] = [
  { id: "model", label: "model (bellman current)" },
  { id: "model-plus-frozen-top-left", label: "model + frozen top-left (old)" },
  { id: "cy-direct-frozen", label: "cy direct frozen (naive)" },
];

const CORNERS: ResizeCorner[] = ["nw", "ne", "sw", "se"];
const HANDLE_SIZE = 12;
const HANDLE_GAP = 8;

const CORNER_CURSOR: Record<ResizeCorner, string> = {
  nw: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  se: "nwse-resize",
};

function formatDelta(dx: number, dy: number): string {
  const mag = Math.hypot(dx, dy);
  if (mag < 0.05) {
    return "0";
  }
  return `${dx.toFixed(2)}, ${dy.toFixed(2)} (${mag.toFixed(2)})`;
}

function clientPointFromDomEvent(
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

function clientPointFromOriginalEvent(originalEvent: Event | undefined): { clientX: number; clientY: number } | null {
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

function wireDetachedDragListeners(
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

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const compoundRef = useRef(DEMO_COMPOUND);
  const childDragCleanupRef = useRef<(() => void) | null>(null);
  const resizeStartRef = useRef<{
    corner: ResizeCorner;
    startClientX: number;
    startClientY: number;
    zoom: number;
    startModel: ReturnType<typeof DEMO_COMPOUND.cloneModel>;
    baseline: GraphSnapshot;
  } | null>(null);

  const [scenario, setScenario] = useState<Scenario>("measured");
  const [syncMode, setSyncMode] = useState<SyncMode>("model");
  const [preserveOnMeasure, setPreserveOnMeasure] = useState(true);
  const [resizeTiming, setResizeTiming] = useState<ResizeTiming>("live");
  const [graphKey, setGraphKey] = useState(0);
  const [handleRect, setHandleRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [baseline, setBaseline] = useState<GraphSnapshot | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<GraphSnapshot | null>(null);
  const [modelSnapshot, setModelSnapshot] = useState<string>("");
  const [childDragVisual, setChildDragVisual] = useState<ChildDragVisual | null>(null);
  const [parentDragVisual, setParentDragVisual] = useState<ParentDragVisual | null>(null);

  const compound = compoundRef.current;

  const refreshDebug = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    setLiveSnapshot(compound.liveSnapshot(cy));
    setModelSnapshot(compound.modelDebugSnapshot());
    setChildDragVisual(compound.childDragVisual(cy));
    setParentDragVisual(compound.parentDragVisual(cy));
  }, [compound]);

  const recomputeHandles = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) {
      setHandleRect(null);
      return;
    }
    setHandleRect(compound.renderedHandleBox(cy));
  }, [compound]);

  useEffect(() => {
    compound.setSyncMode(syncMode);
  }, [compound, syncMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const cy = createDemoCy(container, scenario);
    cyRef.current = cy;

    cy.ready(() => {
      const snap = compound.initializeFromCy(cy, scenario, preserveOnMeasure);
      setBaseline(snap);
      setLiveSnapshot(snap);
      refreshDebug();
      recomputeHandles();
    });

    const onRender = () => {
      recomputeHandles();
      if (!compound.isChildDragInProgress()) {
        refreshDebug();
      }
    };
    cy.on("render zoom pan", onRender);

    const onSelectionChange = () => {
      recomputeHandles();
      refreshDebug();
    };
    cy.on("select unselect", onSelectionChange);

    const stopChildDrag = () => {
      compound.finishChildDrag(cy);
      childDragCleanupRef.current?.();
      childDragCleanupRef.current = null;
      recomputeHandles();
      refreshDebug();
    };

    const onChildDragStart = (event: EventObject) => {
      if (event.target.id() !== compound.child.id) {
        return;
      }

      const clientPoint = clientPointFromOriginalEvent(event.originalEvent as Event | undefined);
      if (!clientPoint) {
        return;
      }

      const originalEvent = event.originalEvent as Event | undefined;
      originalEvent?.preventDefault?.();
      originalEvent?.stopPropagation?.();

      childDragCleanupRef.current?.();
      childDragCleanupRef.current = null;

      const baselineSnap = compound.snapshot(cy);
      setBaseline(baselineSnap);
      setLiveSnapshot(baselineSnap);

      compound.beginChildDrag(cy);
      refreshDebug();

      const startClientPoint = clientPoint;

      const onWindowMove = (domEvent: MouseEvent | PointerEvent | TouchEvent) => {
        const nextClientPoint = clientPointFromDomEvent(domEvent);
        if (!nextClientPoint) {
          return;
        }
        domEvent.preventDefault();
        compound.syncChildDragByDelta(cy, {
          x: (nextClientPoint.clientX - startClientPoint.clientX) / cy.zoom(),
          y: (nextClientPoint.clientY - startClientPoint.clientY) / cy.zoom(),
        });
        refreshDebug();
      };

      const onWindowUp = (domEvent: MouseEvent | PointerEvent | TouchEvent) => {
        domEvent.preventDefault();
        stopChildDrag();
      };

      childDragCleanupRef.current = wireDetachedDragListeners(originalEvent, onWindowMove, onWindowUp);
    };
    cy.on("tapstart", `node#${compound.child.id}`, onChildDragStart);

    compound.attachParentDragHandlers(cy, {
      onGrab: (snap) => {
        setBaseline(snap);
        setLiveSnapshot(snap);
        refreshDebug();
      },
      onChange: () => {
        recomputeHandles();
        refreshDebug();
      },
    });

    return () => {
      childDragCleanupRef.current?.();
      childDragCleanupRef.current = null;
      cy.destroy();
      cyRef.current = null;
    };
  }, [graphKey, preserveOnMeasure, recomputeHandles, refreshDebug, scenario, compound]);

  const applyResize = useCallback(
    (clientX: number, clientY: number) => {
      const active = resizeStartRef.current;
      const cy = cyRef.current;
      if (!active || !cy) {
        return;
      }

      const dxModel = (clientX - active.startClientX) / active.zoom;
      const dyModel = (clientY - active.startClientY) / active.zoom;
      compound.resizeFromCorner(active.corner, dxModel, dyModel, active.startModel);

      if (resizeTiming === "live") {
        compound.syncToCy(cy);
        recomputeHandles();
      }

      refreshDebug();
    },
    [compound, recomputeHandles, refreshDebug, resizeTiming],
  );

  const finishResize = useCallback(
    (clientX: number, clientY: number) => {
      const active = resizeStartRef.current;
      const cy = cyRef.current;
      if (!active || !cy) {
        return;
      }

      applyResize(clientX, clientY);

      if (resizeTiming === "deferred") {
        compound.syncToCy(cy);
        recomputeHandles();
        refreshDebug();
      }

      resizeStartRef.current = null;
    },
    [applyResize, compound, recomputeHandles, refreshDebug, resizeTiming],
  );

  const onHandlePointerDown = useCallback(
    (corner: ResizeCorner) => (event: ReactPointerEvent<HTMLDivElement>) => {
      const cy = cyRef.current;
      if (!cy) {
        return;
      }

      compound.ensureModelFromCy(cy);

      event.preventDefault();
      event.stopPropagation();
      (event.target as HTMLElement).setPointerCapture(event.pointerId);

      const baselineSnap = compound.snapshot(cy);
      setBaseline(baselineSnap);

      resizeStartRef.current = {
        corner,
        startClientX: event.clientX,
        startClientY: event.clientY,
        zoom: cy.zoom(),
        startModel: compound.cloneModel(),
        baseline: baselineSnap,
      };
    },
    [compound],
  );

  const deltas = useMemo(() => {
    if (!baseline || !liveSnapshot) {
      return null;
    }
    return snapshotDelta(baseline, liveSnapshot);
  }, [baseline, liveSnapshot]);

  return (
    <div className="app">
      <div className="graph-panel">
        <div className="toolbar">
          <label>
            Scenario
            <select
              value={scenario}
              onChange={(event) => {
                setScenario(event.target.value as Scenario);
                setGraphKey((value) => value + 1);
              }}
            >
              <option value="measured">Measured (no saved w/h — like bundled example)</option>
              <option value="preset-sized">Preset sized (420×280 in layout)</option>
            </select>
          </label>

          <label>
            Cy sync mode
            <select value={syncMode} onChange={(event) => setSyncMode(event.target.value as SyncMode)}>
              {SYNC_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Resize timing
            <select
              value={resizeTiming}
              onChange={(event) => setResizeTiming(event.target.value as ResizeTiming)}
            >
              <option value="live">Live (sync every pointermove)</option>
              <option value="deferred">Deferred (sync on pointerup)</option>
            </select>
          </label>

          <label>
            Measure pinning
            <select
              value={preserveOnMeasure ? "preserve" : "naive"}
              onChange={(event) => {
                setPreserveOnMeasure(event.target.value === "preserve");
                setGraphKey((value) => value + 1);
              }}
            >
              <option value="preserve">Preserve child absolute on measure</option>
              <option value="naive">Naive applyFrozenCompoundSize only</option>
            </select>
          </label>

          <button type="button" className="reset-button" onClick={() => setGraphKey((value) => value + 1)}>
            Reset graph
          </button>
        </div>

        <div className="graph-shell">
          <div
            className={`graph-viewport${childDragVisual ? " graph-viewport-dragging" : ""}`}
            ref={containerRef}
          />
          {parentDragVisual ? (
            <div
              className={`compound-parent-overlay${parentDragVisual.selected ? " is-selected" : ""}`}
              style={{
                left: parentDragVisual.left,
                top: parentDragVisual.top,
                width: parentDragVisual.width,
                height: parentDragVisual.height,
              }}
            >
              <div className="compound-parent-label">{parentDragVisual.label}</div>
            </div>
          ) : null}
          {childDragVisual ? (
            <div className="child-drag-layer">
              <div
                className="child-drag-ghost"
                style={{
                  left: childDragVisual.renderedX,
                  top: childDragVisual.renderedY,
                }}
              >
                <div
                  className="child-drag-node"
                  style={{
                    backgroundColor: childDragVisual.color,
                    transform: `translate(-50%, -50%) scale(${childDragVisual.zoom})`,
                  }}
                />
                <div
                  className="child-drag-label"
                  style={{
                    top: `${childDragVisual.zoom * 30}px`,
                    transform: `translateX(-50%) scale(${Math.max(1, childDragVisual.zoom * 0.95)})`,
                  }}
                >
                  {childDragVisual.label}
                </div>
              </div>
            </div>
          ) : null}
          {handleRect
            ? CORNERS.map((corner) => {
                const isEast = corner === "ne" || corner === "se";
                const isSouth = corner === "sw" || corner === "se";
                const left = isEast
                  ? handleRect.left + handleRect.width + HANDLE_GAP
                  : handleRect.left - HANDLE_GAP - HANDLE_SIZE;
                const top = isSouth
                  ? handleRect.top + handleRect.height + HANDLE_GAP
                  : handleRect.top - HANDLE_GAP - HANDLE_SIZE;
                return (
                  <div
                    key={corner}
                    className="compound-resize-handle"
                    data-corner={corner}
                    style={{
                      left,
                      top,
                      width: HANDLE_SIZE,
                      height: HANDLE_SIZE,
                      cursor: CORNER_CURSOR[corner],
                    }}
                    onPointerDown={onHandlePointerDown(corner)}
                    onPointerMove={(event) => {
                      if (!resizeStartRef.current) {
                        return;
                      }
                      event.preventDefault();
                      applyResize(event.clientX, event.clientY);
                    }}
                    onPointerUp={(event) => {
                      event.preventDefault();
                      finishResize(event.clientX, event.clientY);
                    }}
                    onPointerCancel={(event) => {
                      finishResize(event.clientX, event.clientY);
                    }}
                  />
                );
              })
            : null}
        </div>
      </div>

      <aside className="debug-panel">
        <h1>Nested compound resize toy</h1>
        <p>
          Mirrors bellman-gui&apos;s <code>wp-invoicing</code> → <code>wp-pdf-export</code> setup.
          Drag the child or a corner handle and watch whether parent absolute coordinates drift.
        </p>

        <h2>Child absolute delta (since gesture start)</h2>
        {deltas ? (
          <pre>
            {Object.entries(deltas).map(([id, delta]) => {
              const bad = Math.hypot(delta.dx, delta.dy) > 0.5;
              return (
                <div key={id} className={bad ? "delta-bad" : "delta-ok"}>
                  {id}: {formatDelta(delta.dx, delta.dy)}
                </div>
              );
            })}
          </pre>
        ) : (
          <pre>Drag the child or a handle to compare.</pre>
        )}

        <h2>Live Cytoscape snapshot</h2>
        <pre>{liveSnapshot ? JSON.stringify(liveSnapshot, null, 2) : "…"}</pre>

        <h2>Layout model (in memory)</h2>
        <pre>{modelSnapshot || "…"}</pre>
      </aside>
    </div>
  );
}
