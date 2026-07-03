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
  compoundChromeRenderedBox,
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
        parent: this.parent.id,
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
        startRenderedCenter: { x: number; y: number };
        currentRenderedCenter: { x: number; y: number };
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
          color: this.color,
          ...(preset ? { compoundWidth: preset.w, compoundHeight: preset.h } : {}),
        },
        position: { x: preset?.x ?? 0, y: preset?.y ?? 0 },
      },
      this.child.toElementDefinition(),
    ];
  }

  /** Initial Cytoscape setup: measure or lock, then snapshot the authoritative model. */
  initializeFromCy(cy: Core, scenario: Scenario, preserveChildAbsolute: boolean): GraphSnapshot {
    if (scenario === "measured") {
      this.measureLikeBellman(cy, preserveChildAbsolute);
    } else {
      cy.getElementById(this.id).lock();
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
    const box = compoundChromeRenderedBox(parent);
    return {
      left: box.x1,
      top: box.y1,
      width: box.x2 - box.x1,
      height: box.y2 - box.y1,
    };
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

  childDragVisual(cy: Core): ChildDragVisual | null {
    const session = this.childDragSession;
    if (!this.childDragActive || !session) {
      return null;
    }
    return {
      renderedX: session.currentRenderedCenter.x,
      renderedY: session.currentRenderedCenter.y,
      zoom: cy.zoom(),
      label: this.child.label,
      color: this.child.color,
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
    this.restoreChildVisibility(cy);
    this.enableDirectDragging(cy);
    this.configureDetachedChildDrag(cy);
  }

  /**
   * Drive child dragging from a dedicated drag session rather than Cytoscape's transient
   * compound coordinates. During the gesture we only update the in-memory model; Cytoscape
   * is updated once at the end of the drag.
   */
  syncChildDragByDelta(delta: {
    graph: { x: number; y: number };
    rendered: { x: number; y: number };
  }): void {
    const session = this.childDragSession;
    if (!session || !this.childDragActive) {
      return;
    }

    const nextModel = moveChild(session.startModel, this.child.id, {
      x: session.startChildAbsolute.x + delta.graph.x - session.parentAbsolute.x,
      y: session.startChildAbsolute.y + delta.graph.y - session.parentAbsolute.y,
    });
    this.model = nextModel;
    session.currentRenderedCenter = {
      x: session.startRenderedCenter.x + delta.rendered.x,
      y: session.startRenderedCenter.y + delta.rendered.y,
    };
  }

  isChildDragInProgress(): boolean {
    return this.childDragActive;
  }

  beginChildDrag(cy: Core): void {
    const model = this.syncModelFromCy(cy);
    const cyChild = cy.getElementById(this.child.id);
    if (cyChild.empty()) {
      return;
    }

    const childAbsolute = compoundAbsolutePosition(cyChild);
    const childRendered = cyChild.renderedPosition();
    this.childDragActive = true;
    this.childDragSession = {
      startModel: cloneLayoutModel(model),
      parentAbsolute: absoluteCenter(model, this.id),
      startChildAbsolute: childAbsolute,
      startRenderedCenter: { x: childRendered.x, y: childRendered.y },
      currentRenderedCenter: { x: childRendered.x, y: childRendered.y },
    };

    const parent = cy.getElementById(this.id);
    const child = cy.getElementById(this.child.id);
    if (parent.empty() || child.empty()) {
      return;
    }
    child.style("opacity", 0);
    child.style("events", "no");
    parent.ungrabify();
    parent.lock();
  }

  /** Commit the dragged child position into the model and sync once. */
  finishChildDrag(cy: Core): void {
    const model = this.model;
    if (!model) {
      this.childDragActive = false;
      this.childDragSession = null;
      this.restoreChildVisibility(cy);
      this.enableDirectDragging(cy);
      this.configureDetachedChildDrag(cy);
      return;
    }

    this.childDragActive = false;
    this.childDragSession = null;
    this.syncToCy(cy);
  }

  /**
   * Parent dragging is allowed to update Cytoscape directly because the visual behavior
   * already feels correct. We only need to mirror the dragged center back into the model
   * so the debug panel stays in sync.
   */
  syncParentDragFromCy(cy: Core): void {
    const model = this.ensureModelFromCy(cy);
    const cyParent = cy.getElementById(this.id);
    if (cyParent.empty()) {
      return;
    }
    this.model = moveComposite(model, this.id, cyParent.position());
  }

  attachParentDragHandlers(
    cy: Core,
    callbacks: { onGrab?: (snap: GraphSnapshot) => void; onChange?: () => void },
  ): void {
    const onGrab = (event: EventObject) => {
      if (event.target.id() !== this.id || this.childDragActive) {
        return;
      }
      this.syncParentDragFromCy(cy);
      callbacks.onGrab?.(this.snapshot(cy));
    };

    const onDrag = (event: EventObject) => {
      if (event.target.id() !== this.id || this.childDragActive) {
        return;
      }
      this.syncParentDragFromCy(cy);
      callbacks.onChange?.();
    };

    const onFree = (event: EventObject) => {
      if (event.target.id() !== this.id || this.childDragActive) {
        return;
      }
      this.syncParentDragFromCy(cy);
      callbacks.onChange?.();
    };

    cy.on("grab", `node#${this.id}`, onGrab);
    cy.on("drag", `node#${this.id}`, onDrag);
    cy.on("free", `node#${this.id}`, onFree);
  }

  private measureLikeBellman(cy: Core, preserveChildAbsolute: boolean): void {
    cy.batch(() => {
      const parent = cy.getElementById(this.id);
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
