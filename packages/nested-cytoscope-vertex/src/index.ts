/**
 * Nested compound graph vertex for Cytoscape.
 *
 * Models a compound parent with owned leaf children, keeping layout state authoritative
 * while Cytoscape renders transparent container nodes and DOM overlays for borders/labels.
 *
 * @example
 * ```ts
 * import cytoscape from "cytoscape";
 * import {
 *   GraphParentVertex,
 *   createCompoundGraphStylesheet,
 * } from "@dgillard/nested-cytoscope-vertex";
 *
 * const parent = GraphParentVertex.create({
 *   id: "wp-invoicing",
 *   label: "wp-invoicing",
 *   color: "#64748b",
 *   children: [{ id: "child-a", label: "child-a", color: "#94a3b8" }],
 * });
 *
 * const cy = cytoscape({
 *   container: document.getElementById("graph")!,
 *   style: createCompoundGraphStylesheet(),
 *   elements: parent.buildElements(),
 *   layout: { name: "preset", fit: true, padding: 40 },
 * });
 *
 * cy.ready(() => parent.initializeFromCy(cy));
 * ```
 *
 * @packageDocumentation
 */

export {
  GraphParentVertex,
  type GraphChildVertexSpec,
  type ChildDragVisual,
  type ParentDragVisual,
  type RenderedBoxRect,
} from "./compound-graph";

export { type GraphSnapshot, snapshotDelta } from "./cytoscape-utils";

export type { ResizeCorner, ResizeChildConstraints, ResizeLooseEdges } from "./layout-model";

export {
  type CompoundGraphTheme,
  type LeafDomVisualStyle,
  DEFAULT_COMPOUND_GRAPH_THEME,
  createCompoundGraphStylesheet,
  leafDomVisualStyle,
} from "./cytoscape-theme";
