import { type Core } from "cytoscape";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DEFAULT_COMPOUND_GRAPH_THEME,
  leafDomVisualStyle,
  snapshotDelta,
  type ChildDragVisual,
  type GraphSnapshot,
  type LeafDomVisualStyle,
  type ParentDragVisual,
  type RenderedBoxRect,
  type ResizeChildConstraints,
  type ResizeCorner,
} from "@dgillard/nested-cytoscope-vertex";
import { createDemoCy, DEMO_COMPOUND } from "./demo-graph";

const CORNERS: ResizeCorner[] = ["nw", "ne", "sw", "se"];
const HANDLE_SIZE = 12;
const HANDLE_GAP = 8;
const RESIZE_MOVE_THRESHOLD_PX = 2;

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

function readCssLengthValue(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface ChildVisualStyle extends LeafDomVisualStyle {}

const DEFAULT_CHILD_VISUAL_STYLE: ChildVisualStyle = leafDomVisualStyle();
const THEME = DEFAULT_COMPOUND_GRAPH_THEME;

function readComputedChildVisualStyle(
  labelElement: HTMLElement | null,
  nodeElement: HTMLElement | null,
  selectedNodeElement: HTMLElement | null,
): ChildVisualStyle {
  if (!labelElement || !nodeElement || !selectedNodeElement) {
    return DEFAULT_CHILD_VISUAL_STYLE;
  }
  const labelStyle = window.getComputedStyle(labelElement);
  const nodeStyle = window.getComputedStyle(nodeElement);
  const selectedNodeStyle = window.getComputedStyle(selectedNodeElement);
  return {
    fontSize: readCssLengthValue(labelStyle.fontSize, THEME.leafLabel.fontSize),
    fontFamily: labelStyle.fontFamily || THEME.leafLabel.fontFamily,
    fontWeight: labelStyle.fontWeight || String(THEME.leafLabel.fontWeight),
    color: labelStyle.color || THEME.leafLabel.color,
    labelOutlineWidth: readCssLengthValue(
      labelStyle.getPropertyValue("--child-label-outline-width"),
      THEME.leafLabel.outlineWidth,
    ),
    labelOutlineColor:
      labelStyle.getPropertyValue("--child-label-outline-color").trim() ||
      THEME.leafLabel.outlineColor,
    labelMarginY: readCssLengthValue(
      labelStyle.getPropertyValue("--child-label-gap-y"),
      THEME.leafLabel.marginY,
    ),
    nodeWidth: readCssLengthValue(nodeStyle.width, THEME.leafNode.diameter),
    nodeHeight: readCssLengthValue(nodeStyle.height, THEME.leafNode.diameter),
    selectionOutlineWidth: readCssLengthValue(
      selectedNodeStyle.getPropertyValue("--child-selection-ring-width"),
      THEME.leafSelection.outlineWidth,
    ),
    selectionOutlineColor:
      selectedNodeStyle.getPropertyValue("--child-selection-ring-color").trim() ||
      THEME.leafSelection.outlineColor,
  };
}

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const childLabelProbeRef = useRef<HTMLDivElement>(null);
  const childNodeProbeRef = useRef<HTMLDivElement>(null);
  const childSelectedNodeProbeRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const compoundRef = useRef(DEMO_COMPOUND);
  const childVisualStyleSignatureRef = useRef("");
  const childVisualStyleRef = useRef<ChildVisualStyle>(DEFAULT_CHILD_VISUAL_STYLE);
  const referenceZoomRef = useRef(1);
  const resizeStartRef = useRef<{
    corner: ResizeCorner;
    startClientX: number;
    startClientY: number;
    zoom: number;
    startModel: ReturnType<typeof DEMO_COMPOUND.cloneModel>;
    constraints: ResizeChildConstraints;
    baseline: GraphSnapshot;
    moved: boolean;
  } | null>(null);

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
  const [minResizeVisual, setMinResizeVisual] = useState<RenderedBoxRect | null>(null);

  const compound = compoundRef.current;
  const probeChild = compound.children[0];

  const refreshDebug = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    setLiveSnapshot(compound.liveSnapshot(cy));
    setModelSnapshot(compound.modelDebugSnapshot());
    compound.refreshFootprintsFromCy(cy);
    setChildDragVisual(compound.childDragVisual(cy));
    setParentDragVisual(compound.parentDragVisual(cy));
    setMinResizeVisual(compound.minResizeVisual(cy));
  }, [compound]);

  const recomputeHandles = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) {
      setHandleRect(null);
      return;
    }
    setHandleRect(compound.renderedHandleBox(cy));
  }, [compound]);

  const applyConfiguredChildVisualStyle = useCallback((cy: Core): void => {
    const childVisualStyle = readComputedChildVisualStyle(
      childLabelProbeRef.current,
      childNodeProbeRef.current,
      childSelectedNodeProbeRef.current,
    );
    const referenceZoom = referenceZoomRef.current > 0 ? referenceZoomRef.current : 1;
    childVisualStyleRef.current = childVisualStyle;
    childVisualStyleSignatureRef.current = JSON.stringify(childVisualStyle);
    cy.batch(() => {
      cy.nodes("[kind = 'leaf']").forEach((node) => {
        node.data("labelFontSize", childVisualStyle.fontSize / referenceZoom);
        node.data("labelFontFamily", childVisualStyle.fontFamily);
        node.data("labelFontWeight", childVisualStyle.fontWeight);
        node.data("labelColor", childVisualStyle.color);
        node.data("labelOutlineWidth", childVisualStyle.labelOutlineWidth / referenceZoom);
        node.data("labelOutlineColor", childVisualStyle.labelOutlineColor);
        node.data(
          "labelMarginY",
          (childVisualStyle.labelMarginY + childVisualStyle.labelOutlineWidth) / referenceZoom,
        );
        node.data("nodeWidth", childVisualStyle.nodeWidth / referenceZoom);
        node.data("nodeHeight", childVisualStyle.nodeHeight / referenceZoom);
        node.data("selectionOutlineWidth", childVisualStyle.selectionOutlineWidth / referenceZoom);
        node.data("selectionOutlineColor", childVisualStyle.selectionOutlineColor);
      });
    });
  }, []);

  const syncConfiguredChildVisualStyle = useCallback(
    (cy: Core): boolean => {
      const nextStyle = readComputedChildVisualStyle(
        childLabelProbeRef.current,
        childNodeProbeRef.current,
        childSelectedNodeProbeRef.current,
      );
      const nextSignature = JSON.stringify(nextStyle);
      if (nextSignature === childVisualStyleSignatureRef.current) {
        return false;
      }
      applyConfiguredChildVisualStyle(cy);
      return true;
    },
    [applyConfiguredChildVisualStyle],
  );

  const refreshInteriorClearances = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    const zoom = cy.zoom();
    if (!(zoom > 0)) {
      return;
    }

    compound.setEdgeClearance(THEME.childEdgeClearancePx / zoom);
  }, [compound]);

  useEffect(() => {
    refreshInteriorClearances();
  }, [parentDragVisual, refreshInteriorClearances]);

  useEffect(() => {
    const labelProbe = childLabelProbeRef.current;
    const nodeProbe = childNodeProbeRef.current;
    const selectedNodeProbe = childSelectedNodeProbeRef.current;
    if (!labelProbe || !nodeProbe || !selectedNodeProbe || typeof ResizeObserver === "undefined") {
      return;
    }
    const syncFromCss = () => {
      const cy = cyRef.current;
      if (!cy) {
        return;
      }
      if (!syncConfiguredChildVisualStyle(cy)) {
        return;
      }
      setGraphKey((value) => value + 1);
    };
    const resizeObserver = new ResizeObserver(syncFromCss);
    resizeObserver.observe(labelProbe);
    resizeObserver.observe(nodeProbe);
    resizeObserver.observe(selectedNodeProbe);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            syncFromCss();
          });
    mutationObserver?.observe(document.head, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    return () => {
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
    };
  }, [syncConfiguredChildVisualStyle]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const cy = createDemoCy(container);
    cyRef.current = cy;

    cy.ready(() => {
      referenceZoomRef.current = cy.zoom() > 0 ? cy.zoom() : 1;
      applyConfiguredChildVisualStyle(cy);
      const snap = compound.initializeFromCy(cy);
      setBaseline(snap);
      setLiveSnapshot(snap);
      refreshDebug();
      recomputeHandles();
    });

    const onRender = () => {
      syncConfiguredChildVisualStyle(cy);
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

    compound.attachChildDragHandlers(cy, {
      onStart: (_childId, snap) => {
        setBaseline(snap);
        setLiveSnapshot(snap);
        refreshDebug();
      },
      onMove: () => {
        refreshDebug();
      },
      onEnd: () => {
        recomputeHandles();
        refreshDebug();
      },
    });

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
      cy.destroy();
      cyRef.current = null;
      childVisualStyleSignatureRef.current = "";
    };
  }, [applyConfiguredChildVisualStyle, graphKey, recomputeHandles, refreshDebug, compound, syncConfiguredChildVisualStyle]);

  const applyResize = useCallback(
    (clientX: number, clientY: number) => {
      const active = resizeStartRef.current;
      const cy = cyRef.current;
      if (!active || !cy) {
        return;
      }

      const dxModel = (clientX - active.startClientX) / active.zoom;
      const dyModel = (clientY - active.startClientY) / active.zoom;
      compound.resizeFromCorner(active.corner, dxModel, dyModel, active.startModel, active.constraints);
      compound.syncToCy(cy);
      recomputeHandles();
      refreshDebug();
    },
    [compound, recomputeHandles, refreshDebug],
  );

  const finishResize = useCallback(() => {
    resizeStartRef.current = null;
  }, []);

  const onHandlePointerDown = useCallback(
    (corner: ResizeCorner) => (event: ReactPointerEvent<HTMLDivElement>) => {
      const cy = cyRef.current;
      if (!cy) {
        return;
      }

      compound.ensureModelFromCy(cy);
      refreshInteriorClearances();

      const constraints = compound.computeResizeChildConstraints(cy);

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
        constraints,
        baseline: baselineSnap,
        moved: false,
      };
    },
    [compound, refreshInteriorClearances],
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
          <button type="button" className="reset-button" onClick={() => setGraphKey((value) => value + 1)}>
            Reset graph
          </button>
        </div>

        <div className="graph-shell">
          <div ref={childLabelProbeRef} className="child-drag-label style-probe">
            {probeChild?.label ?? "child"}
          </div>
          <div ref={childNodeProbeRef} className="child-drag-node style-probe" />
          <div ref={childSelectedNodeProbeRef} className="child-drag-node is-selected style-probe" />
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
              <div
                className="compound-parent-label"
                style={
                  {
                    "--compound-parent-label-zoom-scale": parentDragVisual.zoomScale,
                  } as CSSProperties
                }
              >
                {parentDragVisual.label}
              </div>
            </div>
          ) : null}
          {minResizeVisual ? (
            <div
              className="compound-min-resize-debug"
              style={{
                left: minResizeVisual.left,
                top: minResizeVisual.top,
                width: minResizeVisual.width,
                height: minResizeVisual.height,
              }}
              title="Child rendered fit bounds (shape + label)"
            />
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
                  className="child-drag-node is-selected"
                  style={{
                    backgroundColor: childDragVisual.color,
                    transform: `translate(-50%, -50%) scale(${childDragVisual.zoomScale})`,
                  }}
                />
                <div
                  className="child-drag-label"
                  style={{
                    top: `${childDragVisual.zoomScale * (childVisualStyleRef.current.nodeHeight / 2 + childVisualStyleRef.current.labelMarginY + childVisualStyleRef.current.labelOutlineWidth)}px`,
                    transform: `translateX(-50%) scale(${childDragVisual.zoomScale})`,
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
                      const active = resizeStartRef.current;
                      if (!active) {
                        return;
                      }
                      const dxPx = event.clientX - active.startClientX;
                      const dyPx = event.clientY - active.startClientY;
                      if (Math.hypot(dxPx, dyPx) < RESIZE_MOVE_THRESHOLD_PX) {
                        return;
                      }
                      active.moved = true;
                      event.preventDefault();
                      applyResize(event.clientX, event.clientY);
                    }}
                    onPointerUp={(event) => {
                      event.preventDefault();
                      finishResize();
                    }}
                    onPointerCancel={() => {
                      finishResize();
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
          Mirrors bellman-gui&apos;s <code>wp-invoicing</code> compound with{" "}
          {compound.children.map((child, index) => (
            <span key={child.id}>
              {index > 0 ? ", " : null}
              <code>{child.label}</code>
            </span>
          ))}
          children. Drag a child or a corner handle and watch whether absolute coordinates drift.
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
          <pre>Drag a child or a handle to compare.</pre>
        )}

        <h2>Live Cytoscape snapshot</h2>
        <pre>{liveSnapshot ? JSON.stringify(liveSnapshot, null, 2) : "…"}</pre>

        <h2>Layout model (in memory)</h2>
        <pre>{modelSnapshot || "…"}</pre>
      </aside>
    </div>
  );
}
