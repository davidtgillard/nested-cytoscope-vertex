import type { StylesheetStyle } from "cytoscape";

/**
 * Fixed clearance reserved inside the compound's border, independent of the child's own
 * footprint (see LeafFootprint in layout-model.ts). `top` reserves room for the parent's
 * title (`.compound-parent-label` in App.css: 20px font starting at top:10px, so ~40px
 * clears its full line height); the rest is just a thin cosmetic gutter along the
 * border, since the child's own measured shape/label footprint - not this padding - is
 * what actually keeps its text from crossing the left/right/bottom edges.
 */
export const COMPOUND_PADDING = {
  top: 40,
  right: 8,
  bottom: 8,
  left: 8,
} as const;

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
      "font-size": 11,
      color: "#e2e8f0",
      "text-outline-color": "#0f172a",
      "text-outline-width": 2,
    },
  },
  {
    selector: "node[kind = 'leaf']",
    style: {
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": LEAF_LABEL_MARGIN_Y,
      "text-wrap": "wrap",
      "text-max-width": "120px",
      "background-color": "data(color)",
      width: LEAF_NODE_DIAMETER,
      height: LEAF_NODE_DIAMETER,
      shape: "ellipse",
      "z-index": 10,
    },
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
    style: {
      "border-width": 3,
      "border-color": "#38bdf8",
      "border-opacity": 1,
    },
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
