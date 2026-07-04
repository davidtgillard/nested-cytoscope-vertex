import type { Core, EventObject } from "cytoscape";
import cytoscape from "cytoscape";
import { applyLayoutModelToCy, layoutModelFromCy } from "./cytoscape-sync";
import {
  CYTOSCAPE_STYLESHEET,
  CHILD_EDGE_CLEARANCE_PX,
  COMPOUND_PADDING,
  LEAF_LABEL_COLOR,
  LEAF_LABEL_FONT_FAMILY,
  LEAF_LABEL_FONT_SIZE,
  LEAF_LABEL_MARGIN_Y,
  LEAF_LABEL_OUTLINE_COLOR,
  LEAF_LABEL_OUTLINE_WIDTH,
  LEAF_LABEL_FONT_WEIGHT,
  LEAF_NODE_DIAMETER,
  LEAF_SELECTION_OUTLINE_COLOR,
  LEAF_SELECTION_OUTLINE_WIDTH,
} from "./cytoscape-theme";
import {
  INITIAL_COMPOUND_SLACK,
  compoundAbsolutePosition,
  compoundSizeForContent,
  childrenFitBoxAbsoluteFromCy,
  snapshotGraphState,
  syncLeafFootprintsFromCy,
  type GraphSnapshot,
} from "./cytoscape-utils";
import {
  absoluteCenter,
  cloneLayoutModel,
  compositeOuterBox,
  moveComposite,
  moveChild,
  resizeComposite,
  resizeLooseEdgesFromOuter,
  type LayoutNodeInput,
  type ResizeChildConstraints,
  type ResizeCorner,
  type WorkPackageLayoutModel,
} from "./layout-model";

export interface ChildDragVisual {
  renderedX: number;
  renderedY: number;
  zoom: number;
  zoomScale: number;
  label: string;
  color: string;
}

export interface ParentDragVisual {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  selected: boolean;
  /**
   * Current zoom relative to the zoom Cytoscape's initial `fit: true` layout landed on
   * (1 = unchanged since first render), so the DOM title overlay can shrink/grow as the
   * user actually zooms in or out while leaving `.compound-parent-label { font-size: ... }`
   * in App.css as the authoritative base size.
   */
  zoomScale: number;
}

export interface RenderedBoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GraphChildVertexSpec {
  id: string;
  label: string;
  color: string;
  x?: number;
  y?: number;
}

/** Leaf node owned exclusively by its compound parent. */
export class GraphChildVertex {
  private constructor(
    readonly id: string,
    readonly label: string,
    readonly color: string,
    private readonly preset: { x: number; y: number },
  ) {}

  /** Factory for GraphParentVertex only (same module). */
  static attach(spec: GraphChildVertexSpec): GraphChildVertex {
    return new GraphChildVertex(
      spec.id,
      spec.label,
      spec.color,
      { x: spec.x ?? 0, y: spec.y ?? 0 },
    );
  }

  toElementDefinition(): cytoscape.ElementDefinition {
    return {
      data: {
        id: this.id,
        label: this.label,
        kind: "leaf",
        color: this.color,
        labelFontSize: LEAF_LABEL_FONT_SIZE,
        labelFontFamily: LEAF_LABEL_FONT_FAMILY,
        labelFontWeight: LEAF_LABEL_FONT_WEIGHT,
        labelColor: LEAF_LABEL_COLOR,
        labelOutlineWidth: LEAF_LABEL_OUTLINE_WIDTH,
        labelOutlineColor: LEAF_LABEL_OUTLINE_COLOR,
        labelMarginY: LEAF_LABEL_MARGIN_Y,
        nodeWidth: LEAF_NODE_DIAMETER,
        nodeHeight: LEAF_NODE_DIAMETER,
        selectionOutlineWidth: LEAF_SELECTION_OUTLINE_WIDTH,
        selectionOutlineColor: LEAF_SELECTION_OUTLINE_COLOR,
      },
      position: { ...this.preset },
    };
  }

  /** Read-only view of this child's absolute center in the layout model. */
  absoluteCenter(model: WorkPackageLayoutModel): { x: number; y: number } {
    return absoluteCenter(model, this.id);
  }
}

/** Compound parent that owns its children and guards all layout mutations. */
export class GraphParentVertex {
  readonly children: readonly GraphChildVertex[];
  private model: WorkPackageLayoutModel | null = null;
  /** Zoom captured right after the initial `fit: true` layout lands; see ParentDragVisual.zoomScale. */
  private referenceZoom = 1;
  private childDragActive = false;
  private childDragSession:
    | {
        childId: string;
        startModel: WorkPackageLayoutModel;
        parentAbsolute: { x: number; y: number };
        startChildAbsolute: { x: number; y: number };
        renderedOffset: { x: number; y: number };
        previousAutoungrabify: boolean;
        previousUserPanningEnabled: boolean;
      }
    | null = null;

  private constructor(
    readonly id: string,
    readonly label: string,
    readonly color: string,
    childSpecs: GraphChildVertexSpec[],
  ) {
    this.children = childSpecs.map((spec) => GraphChildVertex.attach(spec));
  }

  static create(spec: {
    id: string;
    label: string;
    color: string;
    children: GraphChildVertexSpec[];
  }): GraphParentVertex {
    return new GraphParentVertex(spec.id, spec.label, spec.color, spec.children);
  }

  getChild(id: string): GraphChildVertex | undefined {
    return this.children.find((child) => child.id === id);
  }

  get layoutInputs(): LayoutNodeInput[] {
    return [
      { id: this.id, isCompound: true },
      ...this.children.map((child) => ({ id: child.id, parent: this.id })),
    ];
  }

  get childIds(): string[] {
    return this.children.map((child) => child.id);
  }

  getModel(): WorkPackageLayoutModel | null {
    return this.model;
  }

  /**
   * Records how many model units CHILD_EDGE_CLEARANCE_PX currently maps to at the live
   * zoom level (see App.tsx), so the child's left/right/bottom drag clamp stays a
   * constant number of screen pixels from the border no matter how far Cytoscape's
   * `fit: true` layout has zoomed in or out.
   */
  setEdgeClearance(modelUnits: number): void {
    const node = this.model?.nodes.get(this.id);
    if (node) {
      node.reservedEdge = modelUnits;
    }
  }

  modelDebugSnapshot(): string {
    const model = this.model;
    if (!model) {
      return "";
    }
    return JSON.stringify(
      {
        parent: {
          center: model.nodes.get(this.id)?.center,
          size: model.nodes.get(this.id)?.size,
        },
        childrenAbs: Object.fromEntries(
          this.childIds.map((childId) => [childId, absoluteCenter(model, childId)]),
        ),
      },
      null,
      2,
    );
  }

  buildElements(): cytoscape.ElementDefinition[] {
    return [
      {
        data: {
          id: this.id,
          label: this.label,
          kind: "container",
          color: this.color,
        },
        position: { x: 0, y: 0 },
      },
      ...this.children.map((child) => child.toElementDefinition()),
    ];
  }

  /** Initial Cytoscape setup: measure, then snapshot the authoritative model. */
  initializeFromCy(cy: Core): GraphSnapshot {
    this.measureFromCy(cy);
    this.syncModelFromCy(cy);
    this.enableDirectDragging(cy);
    this.configureDetachedChildDrag(cy);
    const zoom = cy.zoom();
    this.referenceZoom = zoom > 0 ? zoom : 1;
    return snapshotGraphState(cy, this.id, this.childIds);
  }

  ensureModelFromCy(cy: Core): WorkPackageLayoutModel {
    if (!this.model || !compositeOuterBox(this.model, this.id)) {
      this.syncModelFromCy(cy);
    }
    if (!this.model) {
      throw new Error("layout model not initialized");
    }
    return this.model;
  }

  cloneModel(): WorkPackageLayoutModel {
    if (!this.model) {
      throw new Error("layout model not initialized");
    }
    return cloneLayoutModel(this.model);
  }

  renderedHandleBox(cy: Core): { left: number; top: number; width: number; height: number } | null {
    const parent = cy.getElementById(this.id);
    if (parent.empty() || !parent.selected()) {
      return null;
    }
    return this.renderedParentBoxFromModel(cy);
  }

  snapshot(cy: Core): GraphSnapshot {
    return snapshotGraphState(cy, this.id, this.childIds);
  }

  liveSnapshot(cy: Core): GraphSnapshot {
    if (!this.childDragActive || !this.model) {
      return this.snapshot(cy);
    }

    const session = this.childDragSession;
    const parent = this.model.nodes.get(this.id);
    const child = session ? this.model.nodes.get(session.childId) : undefined;
    const box = compositeOuterBox(this.model, this.id);
    if (!session || !parent?.size || !child || !box) {
      return this.snapshot(cy);
    }

    const children: GraphSnapshot["children"] = {};
    for (const childId of this.childIds) {
      const childNode = this.model.nodes.get(childId);
      if (childNode) {
        children[childId] = {
          absolute: absoluteCenter(this.model, childId),
          relative: { ...childNode.center },
        };
      }
    }

    return {
      parent: {
        center: absoluteCenter(this.model, this.id),
        relative: { ...parent.center },
        w: parent.size.w,
        h: parent.size.h,
        box,
      },
      children,
    };
  }

  childDragVisual(cy: Core): ChildDragVisual | null {
    const session = this.childDragSession;
    if (!this.childDragActive || !this.model || !session) {
      return null;
    }
    const childVertex = this.getChild(session.childId);
    if (!childVertex) {
      return null;
    }
    const childAbsolute = absoluteCenter(this.model, session.childId);
    return {
      renderedX: childAbsolute.x * cy.zoom() + cy.pan().x + session.renderedOffset.x,
      renderedY: childAbsolute.y * cy.zoom() + cy.pan().y + session.renderedOffset.y,
      zoom: cy.zoom(),
      zoomScale: cy.zoom() / this.referenceZoom,
      label: childVertex.label,
      color: childVertex.color,
    };
  }

  parentDragVisual(cy: Core): ParentDragVisual | null {
    const parent = cy.getElementById(this.id);
    if (parent.empty()) {
      return null;
    }
    const box = this.renderedParentBoxFromModel(cy);
    if (!box) {
      return null;
    }
    return {
      ...box,
      label: this.label,
      selected: parent.selected(),
      zoomScale: cy.zoom() / this.referenceZoom,
    };
  }

  minResizeVisual(cy: Core): RenderedBoxRect | null {
    const model = this.model;
    if (!model) {
      return null;
    }
    syncLeafFootprintsFromCy(cy, model, this.id);
    const box = childrenFitBoxAbsoluteFromCy(cy, model, this.id);
    if (!box) {
      return null;
    }
    return renderedBoxRect(cy, box);
  }

  refreshFootprintsFromCy(cy: Core): void {
    const model = this.model;
    if (!model) {
      return;
    }
    syncLeafFootprintsFromCy(cy, model, this.id);
  }

  computeResizeChildConstraints(cy: Core): ResizeChildConstraints {
    const model = this.ensureModelFromCy(cy);
    syncLeafFootprintsFromCy(cy, model, this.id);
    const zoom = cy.zoom();
    const edgeClearance = zoom > 0 ? CHILD_EDGE_CLEARANCE_PX / zoom : COMPOUND_PADDING.left;
    const parentNode = model.nodes.get(this.id);
    if (parentNode) {
      parentNode.reservedEdge = edgeClearance;
    }
    const childrenBox = childrenFitBoxAbsoluteFromCy(cy, model, this.id);
    const outer = compositeOuterBox(model, this.id);
    if (!childrenBox || !outer) {
      return {
        childrenBox,
        edgeClearance,
        looseEdges: { west: false, east: false, north: false, south: false },
      };
    }
    return {
      childrenBox,
      edgeClearance,
      looseEdges: resizeLooseEdgesFromOuter(outer, childrenBox, edgeClearance),
    };
  }

  resizeFromCorner(
    corner: ResizeCorner,
    dxModel: number,
    dyModel: number,
    startModel: WorkPackageLayoutModel,
    constraints: ResizeChildConstraints,
  ): void {
    this.model = resizeComposite(startModel, this.id, corner, dxModel, dyModel, constraints);
  }

  syncToCy(cy: Core): void {
    if (!this.model) {
      return;
    }
    applyLayoutModelToCy(cy, this.model);
    this.pinParentToModel(cy);
    this.restoreChildVisibility(cy);
    this.enableDirectDragging(cy);
    this.configureDetachedChildDrag(cy);
  }

  isChildDragInProgress(): boolean {
    return this.childDragActive;
  }

  attachChildDragHandlers(
    cy: Core,
    callbacks: {
      onStart?: (childId: string, snap: GraphSnapshot) => void;
      onMove?: () => void;
      onEnd?: () => void;
    },
  ): void {
    const childIdSet = new Set(this.childIds);
    let dragCleanup: (() => void) | null = null;

    const stopChildDrag = () => {
      this.finishChildDrag(cy);
      dragCleanup?.();
      dragCleanup = null;
      callbacks.onEnd?.();
    };

    const onChildDragStart = (event: EventObject) => {
      const childId = event.target.id();
      if (!childIdSet.has(childId) || this.childDragActive) {
        return;
      }

      const clientPoint = clientPointFromOriginalEvent(event.originalEvent as Event | undefined);
      if (!clientPoint) {
        return;
      }

      const originalEvent = event.originalEvent as Event | undefined;
      originalEvent?.preventDefault?.();
      originalEvent?.stopPropagation?.();

      dragCleanup?.();
      dragCleanup = null;

      callbacks.onStart?.(childId, this.snapshot(cy));
      this.beginChildDrag(cy, childId);

      const startClientPoint = clientPoint;

      const onWindowMove = (domEvent: MouseEvent | PointerEvent | TouchEvent) => {
        const nextClientPoint = clientPointFromDomEvent(domEvent);
        if (!nextClientPoint) {
          return;
        }
        domEvent.preventDefault();
        this.syncChildDragByDelta(cy, childId, {
          x: (nextClientPoint.clientX - startClientPoint.clientX) / cy.zoom(),
          y: (nextClientPoint.clientY - startClientPoint.clientY) / cy.zoom(),
        });
        callbacks.onMove?.();
      };

      const onWindowUp = (domEvent: MouseEvent | PointerEvent | TouchEvent) => {
        domEvent.preventDefault();
        stopChildDrag();
      };

      dragCleanup = wireDetachedDragListeners(originalEvent, onWindowMove, onWindowUp);
    };

    cy.on("tapstart", "node[kind = 'leaf']", onChildDragStart);
  }

  attachParentDragHandlers(
    cy: Core,
    callbacks: { onGrab?: (snap: GraphSnapshot) => void; onChange?: () => void },
  ): void {
    let parentMovedDuringGesture = false;

    const onGrab = (event: EventObject) => {
      if (event.target.id() !== this.id || this.childDragActive) {
        return;
      }
      parentMovedDuringGesture = false;
      callbacks.onGrab?.(this.snapshot(cy));
    };

    const onDrag = (event: EventObject) => {
      if (event.target.id() !== this.id || this.childDragActive) {
        return;
      }
      parentMovedDuringGesture = true;
      this.syncParentDragFromCy(cy);
      callbacks.onChange?.();
    };

    const onFree = (event: EventObject) => {
      if (event.target.id() !== this.id || this.childDragActive) {
        return;
      }
      if (parentMovedDuringGesture) {
        this.syncParentDragFromCy(cy);
        callbacks.onChange?.();
      }
      parentMovedDuringGesture = false;
    };

    cy.on("grab", `node#${this.id}`, onGrab);
    cy.on("drag", `node#${this.id}`, onDrag);
    cy.on("free", `node#${this.id}`, onFree);
  }

  private syncChildDragByDelta(
    cy: Core,
    childId: string,
    delta: { x: number; y: number },
  ): void {
    const session = this.childDragSession;
    if (!session || !this.childDragActive || session.childId !== childId) {
      return;
    }

    const nextModel = moveChild(session.startModel, childId, {
      x: session.startChildAbsolute.x + delta.x - session.parentAbsolute.x,
      y: session.startChildAbsolute.y + delta.y - session.parentAbsolute.y,
    });
    this.model = nextModel;
    this.pinParentToModel(cy);
  }

  private beginChildDrag(cy: Core, childId: string): void {
    if (this.childDragActive) {
      return;
    }

    const model = this.ensureModelFromCy(cy);
    syncLeafFootprintsFromCy(cy, model, this.id);
    const cyChild = cy.getElementById(childId);
    if (cyChild.empty()) {
      return;
    }

    const childAbsolute = compoundAbsolutePosition(cyChild);
    const renderedCenter = cyChild.renderedPosition();
    const pan = cy.pan();
    const zoom = cy.zoom();
    const parent = cy.getElementById(this.id);
    if (parent.empty()) {
      return;
    }
    this.childDragActive = true;
    this.childDragSession = {
      childId,
      startModel: cloneLayoutModel(model),
      parentAbsolute: absoluteCenter(model, this.id),
      startChildAbsolute: childAbsolute,
      renderedOffset: {
        x: renderedCenter.x - (childAbsolute.x * zoom + pan.x),
        y: renderedCenter.y - (childAbsolute.y * zoom + pan.y),
      },
      previousAutoungrabify: cy.autoungrabify(),
      previousUserPanningEnabled: cy.userPanningEnabled(),
    };

    cy.autoungrabify(true);
    cy.userPanningEnabled(false);
    cyChild.style("opacity", 0);
    cyChild.style("events", "no");
    this.pinParentToModel(cy);
  }

  private finishChildDrag(cy: Core): void {
    const model = this.model;
    const session = this.childDragSession;
    if (session) {
      cy.autoungrabify(session.previousAutoungrabify);
      cy.userPanningEnabled(session.previousUserPanningEnabled);
    }
    if (!model) {
      this.restoreChildVisibility(cy);
      this.enableDirectDragging(cy);
      this.configureDetachedChildDrag(cy);
      this.childDragActive = false;
      this.childDragSession = null;
      return;
    }

    applyLayoutModelToCy(cy, model);
    this.pinParentToModel(cy);
    this.restoreChildVisibility(cy);
    this.enableDirectDragging(cy);
    this.configureDetachedChildDrag(cy);
    this.childDragActive = false;
    this.childDragSession = null;
  }

  private syncParentDragFromCy(cy: Core): void {
    const model = this.ensureModelFromCy(cy);
    const cyParent = cy.getElementById(this.id);
    if (cyParent.empty()) {
      return;
    }
    this.model = moveComposite(model, this.id, cyParent.position());
    this.applyChildrenPositionsFromModel(cy);
  }

  private applyChildrenPositionsFromModel(cy: Core): void {
    const model = this.model;
    if (!model) {
      return;
    }
    for (const childId of this.childIds) {
      const cyChild = cy.getElementById(childId);
      if (cyChild.empty()) {
        continue;
      }
      cyChild.position(absoluteCenter(model, childId));
    }
  }

  private measureFromCy(cy: Core): void {
    cy.batch(() => {
      const parent = cy.getElementById(this.id);
      if (parent.empty() || parent.data("compoundWidth") !== undefined) {
        return;
      }

      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      let hasChild = false;
      for (const childId of this.childIds) {
        const child = cy.getElementById(childId);
        if (child.empty()) {
          continue;
        }
        hasChild = true;
        const box = child.boundingBox({ includeLabels: true, includeOverlays: false });
        x1 = Math.min(x1, box.x1);
        y1 = Math.min(y1, box.y1);
        x2 = Math.max(x2, box.x2);
        y2 = Math.max(y2, box.y2);
      }
      if (!hasChild) {
        return;
      }

      const fit = compoundSizeForContent({ x1, y1, x2, y2 });
      const w = fit.w + INITIAL_COMPOUND_SLACK;
      const h = fit.h + INITIAL_COMPOUND_SLACK;
      parent.data("compoundWidth", w);
      parent.data("compoundHeight", h);
      parent.position({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
    });
  }

  private enableDirectDragging(cy: Core): void {
    const parent = cy.getElementById(this.id);
    if (parent.empty()) {
      return;
    }
    parent.unlock();
    parent.grabify();
  }

  private configureDetachedChildDrag(cy: Core): void {
    for (const childId of this.childIds) {
      const child = cy.getElementById(childId);
      if (!child.empty()) {
        child.ungrabify();
      }
    }
  }

  private restoreChildVisibility(cy: Core): void {
    for (const childId of this.childIds) {
      const child = cy.getElementById(childId);
      if (!child.empty()) {
        child.removeStyle();
      }
    }
  }

  private pinParentToModel(cy: Core): void {
    const model = this.model;
    if (!model) {
      return;
    }
    const parentNode = model.nodes.get(this.id);
    const parentSize = parentNode?.size;
    if (!parentNode || !parentSize) {
      return;
    }
    const cyParent = cy.getElementById(this.id);
    if (cyParent.empty()) {
      return;
    }
    cy.batch(() => {
      cyParent.data("compoundWidth", parentSize.w);
      cyParent.data("compoundHeight", parentSize.h);
      cyParent.position({ x: parentNode.center.x, y: parentNode.center.y });
    });
  }

  private renderedParentBoxFromModel(
    cy: Core,
  ): { left: number; top: number; width: number; height: number } | null {
    const model = this.model;
    if (!model) {
      return null;
    }
    const box = compositeOuterBox(model, this.id);
    if (!box) {
      return null;
    }
    return renderedBoxRect(cy, box);
  }

  private syncModelFromCy(cy: Core): WorkPackageLayoutModel {
    this.model = layoutModelFromCy(cy, this.layoutInputs);
    return this.model;
  }
}

function renderedBoxRect(
  cy: Core,
  box: { x1: number; y1: number; x2: number; y2: number },
): RenderedBoxRect {
  const pan = cy.pan();
  const zoom = cy.zoom();
  return {
    left: box.x1 * zoom + pan.x,
    top: box.y1 * zoom + pan.y,
    width: (box.x2 - box.x1) * zoom,
    height: (box.y2 - box.y1) * zoom,
  };
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

function clientPointFromOriginalEvent(
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

/** Demo graph: wp-invoicing compound containing two export children. */
export const DEMO_COMPOUND = GraphParentVertex.create({
  id: "wp-invoicing",
  label: "wp-invoicing",
  color: "#64748b",
  children: [
    {
      id: "wp-pdf-export",
      label: "wp-pdf-export",
      color: "#94a3b8",
      x: -60,
      y: 0,
    },
    {
      id: "wp-email-export",
      label: "wp-email-export",
      color: "#a8b4c4",
      x: 60,
      y: 0,
    },
  ],
});

export function createDemoCy(container: HTMLElement): Core {
  return cytoscape({
    container,
    style: CYTOSCAPE_STYLESHEET,
    elements: DEMO_COMPOUND.buildElements(),
    layout: { name: "preset", fit: true, padding: 40 },
    wheelSensitivity: 0.2,
  });
}
