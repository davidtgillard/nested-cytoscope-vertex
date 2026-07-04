import type { StylesheetStyle } from "cytoscape";

/**
 * Fixed clearance reserved inside the compound's border, independent of the child's own
 * footprint (see LeafFootprint in layout-model.ts). The title (`.compound-parent-label`
 * in App.css) now renders *above* the compound's perimeter rather than inside it, so it
 * no longer needs its own interior clearance - all four sides use the same fallback
 * value here, used only before the first render tick lands: while dragging, the live
 * pixel-based clearance in CHILD_EDGE_CLEARANCE_PX (converted to model units in App.tsx,
 * see `reservedEdge`) takes over on every side, including the top.
 */
export const COMPOUND_PADDING = {
  top: 8,
  right: 8,
  bottom: 8,
  left: 8,
} as const;

export const LEAF_LABEL_FONT_SIZE = 11;
export const LEAF_LABEL_FONT_FAMILY = '"Helvetica Neue", Helvetica, sans-serif';
export const LEAF_LABEL_FONT_WEIGHT = 400;
export const LEAF_LABEL_COLOR = "#e2e8f0";
export const LEAF_LABEL_OUTLINE_WIDTH = 2;
export const LEAF_LABEL_OUTLINE_COLOR = "#0f172a";
export const LEAF_SELECTION_OUTLINE_WIDTH = 3;
export const LEAF_SELECTION_OUTLINE_COLOR = "#38bdf8";

/**
 * How close a child's measured footprint may get to the parent's border (all four
 * sides) while being dragged, expressed in real screen pixels rather than model units -
 * so it stays visually consistent no matter how far Cytoscape's `fit: true` initial
 * layout ends up zooming (see GraphParent.setEdgeClearance). Tune this directly to make
 * the child hug the edges more or less tightly.
 */
export const CHILD_EDGE_CLEARANCE_PX = -5;

export const COMPOUND_MIN_WIDTH = 80;
export const COMPOUND_MIN_HEIGHT = 80;

/**
 * Leaf node shape diameter and label gap, shared with the child-drag DOM ghost
 * (see App.tsx) so the ghost's label sits at the same offset as Cytoscape's own
 * `text-valign: bottom` + `text-margin-y` rendering.
 */
export const LEAF_NODE_DIAMETER = 36;
export const LEAF_LABEL_MARGIN_Y = 6;

/**
 * The "container" node is NOT a real Cytoscape compound parent (it has no Cytoscape
 * children). Cytoscape's compound-bounds system unavoidably re-anchors a compound's
 * box to wherever its child currently sits (that's how `min-width-bias-*` works), so
 * there is no way to keep a compound's box visually fixed while a lone child moves
 * inside it. Instead, the container is a plain, explicitly-sized rectangle node whose
 * own Cytoscape rendering is always fully transparent; the visible border/label are
 * drawn by our own DOM overlay (driven by the layout model), and this node exists only
 * so it can be grabbed/dragged like any other node.
 */
export const CYTOSCAPE_STYLESHEET: StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      color: LEAF_LABEL_COLOR,
    },
  },
  {
    selector: "node[kind = 'leaf']",
    style: ({
      "font-size": "data(labelFontSize)",
      "font-family": "data(labelFontFamily)",
      "font-weight": "data(labelFontWeight)",
      color: "data(labelColor)",
      "text-outline-color": "data(labelOutlineColor)",
      "text-outline-width": "data(labelOutlineWidth)",
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": "data(labelMarginY)",
      "text-wrap": "wrap",
      "text-max-width": "120px",
      "background-color": "data(color)",
      width: "data(nodeWidth)",
      height: "data(nodeHeight)",
      shape: "ellipse",
      "z-index": 10,
    } as unknown) as StylesheetStyle["style"],
  },
  {
    selector: "node[kind = 'container']",
    style: {
      shape: "round-rectangle",
      "background-opacity": 0,
      "border-width": 0,
      "border-opacity": 0,
      "text-opacity": 0,
      width: COMPOUND_MIN_WIDTH,
      height: COMPOUND_MIN_HEIGHT,
      "z-index": 0,
    },
  },
  {
    selector: "node[kind = 'container'][compoundWidth]",
    style: {
      width: "data(compoundWidth)",
      height: "data(compoundHeight)",
    } as StylesheetStyle["style"],
  },
  {
    selector: "node[kind = 'leaf']:selected",
    style: ({
      "border-width": 0,
      "underlay-color": "data(selectionOutlineColor)",
      "underlay-opacity": 1,
      "underlay-padding": "data(selectionOutlineWidth)",
      "underlay-shape": "ellipse",
    } as unknown) as StylesheetStyle["style"],
  },
  {
    selector: "edge",
    style: {
      width: 2,
      "line-color": "#64748b",
      "target-arrow-color": "#64748b",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
    },
  },
];
