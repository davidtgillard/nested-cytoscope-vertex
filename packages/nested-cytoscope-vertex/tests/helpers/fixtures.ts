import cytoscape, { type EventObject } from "cytoscape";
import { vi } from "vitest";
import {
  GraphParentVertex,
  createCompoundGraphStylesheet,
} from "@dgillard/nested-cytoscope-vertex";

export const TEST_PARENT = GraphParentVertex.create({
  id: "parent",
  label: "parent",
  color: "#64748b",
  children: [
    { id: "child-a", label: "child-a", color: "#94a3b8", x: -40, y: 0 },
    { id: "child-b", label: "child-b", color: "#a8b4c4", x: 40, y: 0 },
  ],
});

export const DEMO_COMPOUND = GraphParentVertex.create({
  id: "wp-invoicing",
  label: "wp-invoicing",
  color: "#64748b",
  children: [
    { id: "wp-pdf-export", label: "wp-pdf-export", color: "#94a3b8", x: -60, y: 0 },
    { id: "wp-email-export", label: "wp-email-export", color: "#a8b4c4", x: 60, y: 0 },
  ],
});

export function headlessCy(elements: cytoscape.ElementDefinition[]) {
  return cytoscape({
    headless: true,
    style: createCompoundGraphStylesheet(),
    elements,
  });
}

/** Headless fixture with explicit parent dimensions. */
export function sizedDemoElements(): cytoscape.ElementDefinition[] {
  const elements = DEMO_COMPOUND.buildElements();
  const parent = elements[0];
  if (parent.data) {
    parent.data = {
      ...parent.data,
      compoundWidth: 420,
      compoundHeight: 280,
    };
  }
  return elements;
}

export function captureTapstartHandler(cy: cytoscape.Core): (event: EventObject) => void {
  let handler: ((event: EventObject) => void) | undefined;
  const realOn = cy.on.bind(cy);
  vi.spyOn(cy, "on").mockImplementation(((eventName: string, selector: unknown, fn: unknown) => {
    if (eventName === "tapstart" && typeof selector === "string" && typeof fn === "function") {
      handler = fn as (event: EventObject) => void;
    }
    return realOn(eventName as never, selector as never, fn as never);
  }) as typeof cy.on);
  return (event) => {
    if (!handler) {
      throw new Error("tapstart handler was not registered");
    }
    handler(event);
  };
}

export function syntheticTapstart(
  cy: cytoscape.Core,
  childId: string,
  originalEvent: Event,
): EventObject {
  const child = cy.getElementById(childId);
  return {
    target: child,
    originalEvent,
  } as unknown as EventObject;
}
