import { type Core } from "cytoscape";
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
  createDemoCy,
  DEMO_COMPOUND,
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

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const compoundRef = useRef(DEMO_COMPOUND);
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

  const compound = compoundRef.current;

  const refreshDebug = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    setLiveSnapshot(compound.snapshot(cy));
    setModelSnapshot(compound.modelDebugSnapshot());
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
      refreshDebug();
    };
    cy.on("render zoom pan", onRender);

    const onSelectionChange = () => {
      recomputeHandles();
      refreshDebug();
    };
    cy.on("select unselect", onSelectionChange);

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

    compound.attachChildDragHandlers(cy, {
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
          <div className="graph-viewport" ref={containerRef} />
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
