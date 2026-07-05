import { describe, expect, it } from "vitest";
import {
  DEMO_COMPOUND,
  headlessCy,
  sizedDemoElements,
} from "./helpers/fixtures";

describe("compound graph integration", () => {
  it("GraphParentVertex resize preserves both demo children absolutes", () => {
    const cy = headlessCy(sizedDemoElements());

    DEMO_COMPOUND.initializeFromCy(cy);
    DEMO_COMPOUND.setEdgeClearance(0);

    const beforePdf = DEMO_COMPOUND.snapshot(cy).children["wp-pdf-export"].absolute;
    const beforeEmail = DEMO_COMPOUND.snapshot(cy).children["wp-email-export"].absolute;

    const constraints = DEMO_COMPOUND.computeResizeChildConstraints(cy);
    DEMO_COMPOUND.resizeFromCorner("se", 40, 30, DEMO_COMPOUND.cloneModel(), constraints);
    DEMO_COMPOUND.syncToCy(cy);

    const afterPdf = DEMO_COMPOUND.snapshot(cy).children["wp-pdf-export"].absolute;
    const afterEmail = DEMO_COMPOUND.snapshot(cy).children["wp-email-export"].absolute;

    expect(afterPdf.x).toBeCloseTo(beforePdf.x, 3);
    expect(afterPdf.y).toBeCloseTo(beforePdf.y, 3);
    expect(afterEmail.x).toBeCloseTo(beforeEmail.x, 3);
    expect(afterEmail.y).toBeCloseTo(beforeEmail.y, 3);
  });
});
