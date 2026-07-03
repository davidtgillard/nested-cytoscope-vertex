import type { StylesheetStyle } from "cytoscape";

export const COMPOUND_PADDING = {
  top: 52,
  right: 36,
  bottom: 36,
  left: 36,
} as const;

export const COMPOUND_MIN_WIDTH = 80;
export const COMPOUND_MIN_HEIGHT = 80;

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
    selector: "node:childless",
    style: {
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": 6,
      "text-wrap": "wrap",
      "text-max-width": "120px",
      "background-color": "data(color)",
      width: 36,
      height: 36,
      shape: "ellipse",
      "z-index": 10,
    },
  },
  {
    selector: ":parent",
    style: {
      "text-valign": "top",
      "text-halign": "center",
      "text-margin-y": -8,
      "text-wrap": "wrap",
      "text-max-width": "140px",
      shape: "round-rectangle",
      "background-opacity": 0,
      "border-width": 2,
      "border-color": "#64748b",
      "border-opacity": 0.6,
      padding: `${COMPOUND_PADDING.top}px ${COMPOUND_PADDING.right}px ${COMPOUND_PADDING.bottom}px ${COMPOUND_PADDING.left}px`,
      "min-width": `${COMPOUND_MIN_WIDTH}px`,
      "min-height": `${COMPOUND_MIN_HEIGHT}px`,
      "z-index": 0,
    },
  },
  {
    selector: ":parent[compoundWidth]",
    style: {
      "min-width": "data(compoundWidth)",
      "min-width-bias-left": "0%",
      "min-width-bias-right": "100%",
      "min-height": "data(compoundHeight)",
      "min-height-bias-top": "0%",
      "min-height-bias-bottom": "100%",
    } as StylesheetStyle["style"],
  },
  {
    selector: "node:selected:childless",
    style: {
      "border-width": 3,
      "border-color": "#38bdf8",
      "border-opacity": 1,
    },
  },
  {
    selector: ":parent:selected",
    style: {
      "text-opacity": 0,
      "border-width": 2,
      "border-color": "#38bdf8",
      "border-opacity": 1,
      events: "no",
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
