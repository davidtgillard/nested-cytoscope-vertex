import type { Core, EventObject } from "cytoscape";
import cytoscape from "cytoscape";
import {
  applyLayoutModelToCy,
  layoutModelFromCy,
  type SyncMode,
} from "./cytoscape-sync";
import { CYTOSCAPE_STYLESHEET } from "./cytoscape-theme";
import {
  INITIAL_COMPOUND_SLACK,
  compoundAbsolutePosition,
  compoundSizeForContent,
  measureAndPinCompound,
  snapshotGraphState,
  type GraphSnapshot,
} from "./cytoscape-utils";
import {
  absoluteCenter,
  cloneLayoutModel,
  compositeOuterBox,
  moveComposite,
  moveChild,
  resizeComposite,
  type LayoutNodeInput,
  type ResizeCorner,
  type WorkPackageLayoutModel,
} from "./layout-model";

export type Scenario = "measured" | "preset-sized";

export interface ChildDragVisual {
  renderedX: number;
  renderedY: number;
  zoom: number;
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
}

const PRESET_LAYOUT = {
  parent: { x: 0, y: 0, w: 420, h: 280 },
  child: { x: 0, y: 0 },
} as const;

/** Leaf node owned exclusively by its compound parent. */
export class GraphChild {
  private constructor(
    readonly id: string,
    readonly label: string,
    readonly color: string,
    private readonly parent: GraphParent,
  ) {}

  static attach(parent: GraphParent, spec: { id: string; label: string; color: string }): GraphChild {
    return new GraphChild(spec.id, spec.label, spec.color, parent);
  }

  get layoutInput(): LayoutNodeInput {
    return { id: this.id, parent: this.parent.id };
  }

  toElementDefinition(): cytoscape.ElementDefinition {
    return {
      data: {
        id: this.id,
        label: this.label,
        kind: "leaf",
        color: this.color,
      },
      position: { ...PRESET_LAYOUT.child },
    };
  }

  /** Read-only view of this child's absolute center in the layout model. */
  absoluteCenter(model: WorkPackageLayoutModel): { x: number; y: number } {
    return absoluteCenter(model, this.id);
  }
}

/** Compound parent that owns its child and guards all layout mutations. */
export class GraphParent {
  readonly child: GraphChild;
  private model: WorkPackageLayoutModel | null = null;
  private syncMode: SyncMode = "model";
  private childDragActive = false;
  private childDragSession:
    | {
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
    childSpec: { id: string; label: string; color: string },
  ) {
    this.child = GraphChild.attach(this, childSpec);
  }

  static create(spec: {
    id: string;
    label: string;
    color: string;
    child: { id: string; label: string; color: string };
  }): GraphParent {
    return new GraphParent(spec.id, spec.label, spec.color, spec.child);
  }

  get layoutInputs(): LayoutNodeInput[] {
    return [{ id: this.id, isCompound: true }, this.child.layoutInput];
  }

  get childIds(): string[] {
    return [this.child.id];
  }

  setSyncMode(mode: SyncMode): void {
    this.syncMode = mode;
  }

  getModel(): WorkPackageLayoutModel | null {
    return this.model;
  }

  /**
   * Records how many model units the parent's title currently needs, measured from its
   * real rendered DOM box (see App.tsx). Mutates the model in place (no cy round-trip
   * needed) so the very next drag/clamp computation picks it up immediately.
   */
  setTitleClearance(modelUnits: number): void {
    const node = this.model?.nodes.get(this.id);
    if (node) {
      node.reservedTop = modelUnits;
    }
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
        childAbs: this.child.absoluteCenter(model),
      },
      null,
      2,
    );
  }

  buildElements(scenario: Scenario): cytoscape.ElementDefinition[] {
    const preset = scenario === "preset-sized" ? PRESET_LAYOUT.parent : undefined;
    return [
      {
        data: {
          id: this.id,
          label: this.label,
          kind: "container",
          color: this.color,
          ...(preset ? { compoundWidth: preset.w, compoundHeight: preset.h } : {}),
        },
        position: { x: preset?.x ?? 0, y: preset?.y ?? 0 },
      },
      this.child.toElementDefinition(),
    ];
  }

  /** Initial Cytoscape setup: measure (if needed), then snapshot the authoritative model. */
  initializeFromCy(cy: Core, scenario: Scenario, centerContainerOnChild: boolean): GraphSnapshot {
    if (scenario === "measured") {
      this.measureLikeBellman(cy, centerContainerOnChild);
    }

    this.syncModelFromCy(cy);
    this.enableDirectDragging(cy);
    this.configureDetachedChildDrag(cy);
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

    const parent = this.model.nodes.get(this.id);
    const child = this.model.nodes.get(this.child.id);
    const box = compositeOuterBox(this.model, this.id);
    if (!parent?.size || !child || !box) {
      return this.snapshot(cy);
    }

    return {
      parent: {
        center: absoluteCenter(this.model, this.id),
        relative: { ...parent.center },
        w: parent.size.w,
        h: parent.size.h,
        box,
      },
      children: {
        [this.child.id]: {
          absolute: absoluteCenter(this.model, this.child.id),
          relative: { ...child.center },
        },
      },
    };
  }

  /**
   * The ghost always renders with the "selected" ring while a drag is active: our
   * detached-drag gesture (window pointermove/up listeners, see App.tsx) intercepts the
   * interaction before Cytoscape's own tap/select machinery sees a completed short click,
   * so `cyChild.selected()` never flips true mid-drag even though the gesture is a real
   * grab. The ring is therefore a "currently being dragged" indicator, not a mirror of
   * Cytoscape's selection state - it appears for the whole gesture and disappears the
   * instant the ghost is torn down in finishChildDrag.
   */
  childDragVisual(cy: Core): ChildDragVisual | null {
    const session = this.childDragSession;
    if (!this.childDragActive || !this.model || !session) {
      return null;
    }
    const childAbsolute = absoluteCenter(this.model, this.child.id);
    return {
      renderedX: childAbsolute.x * cy.zoom() + cy.pan().x + session.renderedOffset.x,
      renderedY: childAbsolute.y * cy.zoom() + cy.pan().y + session.renderedOffset.y,
      zoom: cy.zoom(),
      label: this.child.label,
      color: this.child.color,
    };
  }

  /**
   * The visible parent border is always derived live from the model plus the current
   * pan/zoom, so it tracks zoom/pan exactly like Cytoscape's own rendering does. The
   * model's parent center/size do not change while a child is being dragged, so this
   * naturally stays fixed in place during the gesture without needing a frozen snapshot.
   */
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
    };
  }

  /** Resize the compound from a corner drag in model coordinates. */
  resizeFromCorner(corner: ResizeCorner, dxModel: number, dyModel: number, startModel: WorkPackageLayoutModel): void {
    this.model = resizeComposite(startModel, this.id, corner, dxModel, dyModel);
  }

  syncToCy(cy: Core): void {
    if (!this.model) {
      return;
    }
    applyLayoutModelToCy(cy, this.model, this.syncMode);
    this.pinParentToModel(cy);
    this.restoreChildVisibility(cy);
    this.enableDirectDragging(cy);
    this.configureDetachedChildDrag(cy);
  }

  /**
   * Drive child dragging from a dedicated drag session rather than Cytoscape's transient
   * compound coordinates. During the gesture we only update the in-memory model; Cytoscape
   * is updated once at the end of the drag.
   */
  syncChildDragByDelta(cy: Core, delta: { x: number; y: number }): void {
    const session = this.childDragSession;
    if (!session || !this.childDragActive) {
      return;
    }

    const nextModel = moveChild(session.startModel, this.child.id, {
      x: session.startChildAbsolute.x + delta.x - session.parentAbsolute.x,
      y: session.startChildAbsolute.y + delta.y - session.parentAbsolute.y,
    });
    this.model = nextModel;
    this.pinParentToModel(cy);
  }

  isChildDragInProgress(): boolean {
    return this.childDragActive;
  }

  beginChildDrag(cy: Core): void {
    const model = this.ensureModelFromCy(cy);
    const cyChild = cy.getElementById(this.child.id);
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

  /** Commit the dragged child position into the model and sync once. */
  finishChildDrag(cy: Core): void {
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

    applyLayoutModelToCy(cy, model, this.syncMode);
    this.pinParentToModel(cy);
    this.restoreChildVisibility(cy);
    this.enableDirectDragging(cy);
    this.configureDetachedChildDrag(cy);
    this.childDragActive = false;
    this.childDragSession = null;
  }

  /**
   * Parent dragging is allowed to update Cytoscape directly because the visual behavior
   * already feels correct. We mirror the dragged center back into the model (so the debug
   * panel stays in sync), then push the child's recomputed absolute position back into
   * Cytoscape. The child has no real `parent` relationship in Cytoscape's own graph (see
   * GraphChild.toElementDefinition), so Cytoscape never drags it along on its own -
   * without this step the child would stay put while the parent's (overlay-rendered)
   * border moves out from under it.
   */
  syncParentDragFromCy(cy: Core): void {
    const model = this.ensureModelFromCy(cy);
    const cyParent = cy.getElementById(this.id);
    if (cyParent.empty()) {
      return;
    }
    this.model = moveComposite(model, this.id, cyParent.position());
    this.applyChildPositionFromModel(cy);
  }

  /** Push the child's model-derived absolute position into its real Cytoscape node. */
  private applyChildPositionFromModel(cy: Core): void {
    const model = this.model;
    if (!model) {
      return;
    }
    const cyChild = cy.getElementById(this.child.id);
    if (cyChild.empty()) {
      return;
    }
    cyChild.position(absoluteCenter(model, this.child.id));
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

  private measureLikeBellman(cy: Core, centerContainerOnChild: boolean): void {
    cy.batch(() => {
      const parent = cy.getElementById(this.id);
      const child = cy.getElementById(this.child.id);
      if (parent.empty() || child.empty()) {
        return;
      }
      if (parent.data("compoundWidth") !== undefined) {
        return;
      }

      const box = child.boundingBox({ includeLabels: true, includeOverlays: false });
      const fit = compoundSizeForContent({ x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 });
      const w = fit.w + INITIAL_COMPOUND_SLACK;
      const h = fit.h + INITIAL_COMPOUND_SLACK;
      if (centerContainerOnChild) {
        measureAndPinCompound(parent, child, w, h);
      } else {
        parent.data("compoundWidth", w);
        parent.data("compoundHeight", h);
      }
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
    const child = cy.getElementById(this.child.id);
    if (child.empty()) {
      return;
    }
    child.ungrabify();
  }

  private restoreChildVisibility(cy: Core): void {
    const child = cy.getElementById(this.child.id);
    if (child.empty()) {
      return;
    }
    child.removeStyle();
  }

  /**
   * Keeps the (invisible) real Cytoscape container node in sync with the model's
   * fixed center/size. The container is a plain node with no real Cytoscape
   * children, so this can never have the side effect of dragging the child along.
   */
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
    const pan = cy.pan();
    const zoom = cy.zoom();
    return {
      left: box.x1 * zoom + pan.x,
      top: box.y1 * zoom + pan.y,
      width: (box.x2 - box.x1) * zoom,
      height: (box.y2 - box.y1) * zoom,
    };
  }

  private syncModelFromCy(cy: Core): WorkPackageLayoutModel {
    this.model = layoutModelFromCy(cy, this.layoutInputs);
    return this.model;
  }
}

/** Demo graph: wp-invoicing compound containing wp-pdf-export. */
export const DEMO_COMPOUND = GraphParent.create({
  id: "wp-invoicing",
  label: "wp-invoicing",
  color: "#64748b",
  child: {
    id: "wp-pdf-export",
    label: "wp-pdf-export",
    color: "#94a3b8",
  },
});

export function createDemoCy(
  container: HTMLElement,
  scenario: Scenario,
): Core {
  return cytoscape({
    container,
    style: CYTOSCAPE_STYLESHEET,
    elements: DEMO_COMPOUND.buildElements(scenario),
    layout: { name: "preset", fit: true, padding: 40 },
    wheelSensitivity: 0.2,
  });
}
