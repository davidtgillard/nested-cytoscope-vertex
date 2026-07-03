import cytoscape, { type Core } from "cytoscape";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CYTOSCAPE_STYLESHEET } from "./lib/cytoscape-theme";
import {
  applyLayoutModelToCy,
  layoutModelFromCy,
  type SyncMode,
} from "./lib/cytoscape-sync";
import {
  INITIAL_COMPOUND_SLACK,
  compoundChromeRenderedBox,
  compoundSizeForContent,
  measureAndPinCompound,
  snapshotDelta,
  snapshotGraphState,
  type GraphSnapshot,
} from "./lib/cytoscape-utils";
import {
  absoluteCenter,
  cloneLayoutModel,
  compositeOuterBox,
  resizeComposite,
  type LayoutNodeInput,
  type ResizeCorner,
  type WorkPackageLayoutModel,
} from "./lib/layout-model";

// This demo keeps the graph intentionally tiny: one compound parent with one child.
// The whole UI exists to show how different resize/sync strategies affect the child's
// absolute position while the parent is being resized.
const PARENT_ID = "wp-invoicing";
const CHILD_ID = "wp-pdf-export";
const CHILD_IDS = [CHILD_ID];

// The layout model utilities expect a normalized description of the graph shape.
const LAYOUT_INPUTS: LayoutNodeInput[] = [
  { id: PARENT_ID, isCompound: true },
  { id: CHILD_ID, parent: PARENT_ID },
];

// "Saved" coordinates used by the preset-sized scenario.
const PRESET_LAYOUT = {
  [PARENT_ID]: { x: 0, y: 0, w: 420, h: 280 },
  [CHILD_ID]: { x: 0, y: 0 },
};

type Scenario = "measured" | "preset-sized";
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

// Recreates the sizing behavior from the bundled Bellman example:
// measure the child content, compute a fitting compound size, then pin that size
// onto the parent. The optional flag controls whether child absolute positions are
// preserved while that measurement is applied.
function measureCompoundLikeBellman(cy: Core, preserveChildAbsolute: boolean): void {
  cy.batch(() => {
    const parent = cy.getElementById(PARENT_ID);
    if (parent.empty() || !parent.isParent()) {
      return;
    }
    if (parent.data("compoundWidth") !== undefined) {
      return;
    }

    const children = parent.children();
    const box = children.nonempty()
      ? children.boundingBox({ includeLabels: true, includeOverlays: false })
      : null;
    const fit = compoundSizeForContent(
      box ? { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 } : null,
    );
    measureAndPinCompound(
      parent,
      fit.w + INITIAL_COMPOUND_SLACK,
      fit.h + INITIAL_COMPOUND_SLACK,
      preserveChildAbsolute,
    );
  });
}

// Build a fresh Cytoscape element set for the selected scenario.
// In the measured mode the parent starts without stored width/height, while
// the preset-sized mode injects previously saved dimensions up front.
function buildElements(scenario: Scenario): cytoscape.ElementDefinition[] {
  const preset = scenario === "preset-sized" ? PRESET_LAYOUT[PARENT_ID] : undefined;
  return [
    {
      data: {
        id: PARENT_ID,
        label: "wp-invoicing",
        color: "#64748b",
        ...(preset ? { compoundWidth: preset.w, compoundHeight: preset.h } : {}),
      },
      position: { x: preset?.x ?? 0, y: preset?.y ?? 0 },
    },
    {
      data: { id: CHILD_ID, label: "wp-pdf-export", parent: PARENT_ID, color: "#94a3b8" },
      position: {
        x: PRESET_LAYOUT[CHILD_ID].x,
        y: PRESET_LAYOUT[CHILD_ID].y,
      },
    },
  ];
}

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const modelRef = useRef<WorkPackageLayoutModel | null>(null);
  // Stores the pointer drag session so each move can be interpreted relative
  // to the original graph/model state instead of compounding incremental error.
  const resizeStartRef = useRef<{
    corner: ResizeCorner;
    startClientX: number;
    startClientY: number;
    zoom: number;
    startModel: WorkPackageLayoutModel;
    baseline: GraphSnapshot;
  } | null>(null);

  const [scenario, setScenario] = useState<Scenario>("measured");
  const [syncMode, setSyncMode] = useState<SyncMode>("model");
  const [preserveOnMeasure, setPreserveOnMeasure] = useState(true);
  const [resizeTiming, setResizeTiming] = useState<ResizeTiming>("live");
  // Bumping this key tears down and rebuilds Cytoscape from scratch.
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

  // Keep the debug sidebar in sync with both the live Cytoscape scene and the
  // in-memory layout model used during resizing.
  const refreshDebug = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    setLiveSnapshot(snapshotGraphState(cy, PARENT_ID, CHILD_IDS));
    const model = modelRef.current;
    if (model) {
      setModelSnapshot(
        JSON.stringify(
          {
            parent: {
              center: model.nodes.get(PARENT_ID)?.center,
              size: model.nodes.get(PARENT_ID)?.size,
            },
            childAbs: absoluteCenter(model, CHILD_ID),
          },
          null,
          2,
        ),
      );
    }
  }, []);

  // The resize handles are regular DOM nodes overlaid on top of Cytoscape, so
  // we recompute their screen-space rectangle from the rendered parent box.
  const recomputeHandles = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) {
      setHandleRect(null);
      return;
    }
    const parent = cy.getElementById(PARENT_ID);
    if (parent.empty()) {
      setHandleRect(null);
      return;
    }
    const box = compoundChromeRenderedBox(parent);
    setHandleRect({
      left: box.x1,
      top: box.y1,
      width: box.x2 - box.x1,
      height: box.y2 - box.y1,
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const cy = cytoscape({
      container,
      style: CYTOSCAPE_STYLESHEET,
      elements: buildElements(scenario),
      layout: { name: "preset", fit: true, padding: 40 },
      wheelSensitivity: 0.2,
    });

    cyRef.current = cy;

    cy.ready(() => {
      // Scenario setup happens once per graph rebuild, before we snapshot the
      // starting state into the parallel layout model/debug views.
      if (scenario === "measured") {
        measureCompoundLikeBellman(cy, preserveOnMeasure);
      } else {
        cy.getElementById(PARENT_ID).lock();
      }

      const model = layoutModelFromCy(cy, LAYOUT_INPUTS);
      modelRef.current = model;
      const snap = snapshotGraphState(cy, PARENT_ID, CHILD_IDS);
      setBaseline(snap);
      setLiveSnapshot(snap);
      refreshDebug();
      recomputeHandles();
    });

    // Any render-affecting event can move the compound on screen, so use a
    // single listener to keep the overlay handles and debug readout aligned.
    const onRender = () => {
      recomputeHandles();
      refreshDebug();
    };
    cy.on("render zoom pan", onRender);

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graphKey, preserveOnMeasure, recomputeHandles, refreshDebug, scenario]);

  const applyResize = useCallback(
    (clientX: number, clientY: number) => {
      const active = resizeStartRef.current;
      const cy = cyRef.current;
      if (!active || !cy) {
        return;
      }

      const dxModel = (clientX - active.startClientX) / active.zoom;
      const dyModel = (clientY - active.startClientY) / active.zoom;
      const next = resizeComposite(
        active.startModel,
        PARENT_ID,
        active.corner,
        dxModel,
        dyModel,
      );
      modelRef.current = next;

      // "Live" mode pushes every intermediate resize step back into Cytoscape.
      // Deferred mode waits until pointerup, letting the sidebar show model-only
      // changes while the rendered graph stays still.
      if (resizeTiming === "live") {
        applyLayoutModelToCy(cy, next, syncMode);
        recomputeHandles();
      }

      refreshDebug();
    },
    [recomputeHandles, refreshDebug, resizeTiming, syncMode],
  );

  const finishResize = useCallback(
    (clientX: number, clientY: number) => {
      const active = resizeStartRef.current;
      const cy = cyRef.current;
      if (!active || !cy) {
        return;
      }

      applyResize(clientX, clientY);

      // Deferred mode performs its single Cytoscape sync at the end of the drag.
      if (resizeTiming === "deferred") {
        applyLayoutModelToCy(cy, modelRef.current!, syncMode);
        recomputeHandles();
        refreshDebug();
      }

      resizeStartRef.current = null;
    },
    [applyResize, recomputeHandles, refreshDebug, resizeTiming, syncMode],
  );

  const onHandlePointerDown = useCallback(
    (corner: ResizeCorner) => (event: ReactPointerEvent<HTMLDivElement>) => {
      const cy = cyRef.current;
      if (!cy) {
        return;
      }

      // If the in-memory model was lost (for example after a rebuild), derive
      // a fresh one from Cytoscape before starting a new resize gesture.
      let model = modelRef.current;
      if (!model || !compositeOuterBox(model, PARENT_ID)) {
        model = layoutModelFromCy(cy, LAYOUT_INPUTS);
        modelRef.current = model;
      }

      event.preventDefault();
      event.stopPropagation();
      (event.target as HTMLElement).setPointerCapture(event.pointerId);

      const baselineSnap = snapshotGraphState(cy, PARENT_ID, CHILD_IDS);
      setBaseline(baselineSnap);

      resizeStartRef.current = {
        corner,
        startClientX: event.clientX,
        startClientY: event.clientY,
        zoom: cy.zoom(),
        startModel: cloneLayoutModel(model),
        baseline: baselineSnap,
      };
    },
    [],
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
          {/* Cytoscape does not provide native resize handles, so we render a DOM
              overlay positioned around the compound's current screen box. */}
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
        {/* The sidebar is part explainer, part instrumentation: it shows whether
            the child drifts and compares Cytoscape's live state with the model. */}
        <h1>Nested compound resize toy</h1>
        <p>
          Mirrors bellman-gui&apos;s <code>wp-invoicing</code> → <code>wp-pdf-export</code> setup.
          Drag a corner handle and watch whether inner node absolute coordinates drift.
        </p>

        <h2>Child absolute delta (since resize start)</h2>
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
          <pre>Drag a handle to compare.</pre>
        )}

        <h2>Live Cytoscape snapshot</h2>
        <pre>{liveSnapshot ? JSON.stringify(liveSnapshot, null, 2) : "…"}</pre>

        <h2>Layout model (in memory)</h2>
        <pre>{modelSnapshot || "…"}</pre>
      </aside>
    </div>
  );
}
