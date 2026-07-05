import type { Core } from "cytoscape";
import cytoscape from "cytoscape";
import {
  GraphParentVertex,
  createCompoundGraphStylesheet,
  DEFAULT_COMPOUND_GRAPH_THEME,
} from "@dgillard/cytoscape-compound-graph";

/** Demo theme overrides — tune spacing and visuals here without editing the library. */
export const DEMO_THEME = {
  ...DEFAULT_COMPOUND_GRAPH_THEME,
  /** Minimum gap between sibling footprints while dragging (model units per side). */
  nodeOverlapPadding: 0,
};

/** Demo graph: wp-invoicing compound containing two export children. */
export const DEMO_COMPOUND = GraphParentVertex.create({
  id: "wp-invoicing",
  label: "wp-invoicing",
  color: "#64748b",
  nodeOverlapPadding: DEMO_THEME.nodeOverlapPadding,
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
    style: createCompoundGraphStylesheet(DEMO_THEME),
    elements: DEMO_COMPOUND.buildElements(),
    layout: { name: "preset", fit: true, padding: 40 },
    wheelSensitivity: 0.2,
  });
}
