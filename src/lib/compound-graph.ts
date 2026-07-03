import type { Core } from "cytoscape";
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

    this.model = layoutModelFromCy(cy, this.layoutInputs);
    this.enableDirectDragging(cy);
    return snapshotGraphState(cy, this.id, this.childIds);
  }

  ensureModelFromCy(cy: Core): WorkPackageLayoutModel {
    if (!this.model || !compositeOuterBox(this.model, this.id)) {
      this.model = layoutModelFromCy(cy, this.layoutInputs);
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
    if (parent.empty()) {
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

  /** Resize the compound from a corner drag in model coordinates. */
  resizeFromCorner(corner: ResizeCorner, dxModel: number, dyModel: number, startModel: WorkPackageLayoutModel): void {
    this.model = resizeComposite(startModel, this.id, corner, dxModel, dyModel);
  }

  syncToCy(cy: Core): void {
    if (!this.model) {
      return;
    }
    applyLayoutModelToCy(cy, this.model, this.syncMode);
    this.enableDirectDragging(cy);
  }

  /**
   * While the user drags the child in Cytoscape, only re-pin the parent's center and
   * extents from the model. Do not rewrite the child position — that fights the drag.
   */
  repinDuringChildDrag(cy: Core): void {
    const model = this.model;
    if (!model || !this.childDragActive) {
      return;
    }

    const layoutNode = model.nodes.get(this.id);
    if (!layoutNode?.size) {
      return;
    }

    const cyParent = cy.getElementById(this.id);
    if (cyParent.empty()) {
      return;
    }

    cy.batch(() => {
      cyParent.unlock();
      cyParent.data("compoundWidth", layoutNode.size!.w);
      cyParent.data("compoundHeight", layoutNode.size!.h);
      cyParent.position({ x: layoutNode.center.x, y: layoutNode.center.y });
      if (cyParent.isParent() && cyParent.children().length > 0) {
        cyParent.lock();
      }
    });
  }

  beginChildDrag(): void {
    this.childDragActive = true;
  }

  /** Commit the dragged child position into the model and sync once. */
  finishChildDrag(cy: Core): void {
    const model = this.model;
    if (!model) {
      this.childDragActive = false;
      return;
    }

    const cyChild = cy.getElementById(this.child.id);
    if (cyChild.empty()) {
      this.childDragActive = false;
      return;
    }

    const childAbs = compoundAbsolutePosition(cyChild);
    const parentAbs = absoluteCenter(model, this.id);
    this.model = moveChild(model, this.child.id, {
      x: childAbs.x - parentAbs.x,
      y: childAbs.y - parentAbs.y,
    });

    this.childDragActive = false;
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
    const onGrab = () => {
      this.syncParentDragFromCy(cy);
      callbacks.onGrab?.(this.snapshot(cy));
    };

    const onDrag = () => {
      this.syncParentDragFromCy(cy);
      callbacks.onChange?.();
    };

    const onFree = () => {
      this.syncParentDragFromCy(cy);
      callbacks.onChange?.();
    };

    cy.on("grab", `node#${this.id}`, onGrab);
    cy.on("drag", `node#${this.id}`, onDrag);
    cy.on("free", `node#${this.id}`, onFree);
  }

  attachChildDragHandlers(
    cy: Core,
    callbacks: { onGrab?: (snap: GraphSnapshot) => void; onChange?: () => void },
  ): void {
    const onGrab = () => {
      this.beginChildDrag();
      callbacks.onGrab?.(this.snapshot(cy));
    };

    const onDrag = () => {
      this.repinDuringChildDrag(cy);
      callbacks.onChange?.();
    };

    const onFree = () => {
      this.finishChildDrag(cy);
      callbacks.onChange?.();
    };

    cy.on("grab", `node#${this.child.id}`, onGrab);
    cy.on("drag", `node#${this.child.id}`, onDrag);
    cy.on("free", `node#${this.child.id}`, onFree);
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
