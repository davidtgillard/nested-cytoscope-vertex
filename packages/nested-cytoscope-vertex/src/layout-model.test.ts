import { describe, expect, it } from "vitest";
import {
  absoluteCenter,
  buildLayoutModel,
  canOverlap,
  flatLayoutFromModel,
  isAncestor,
  moveChild,
  moveComposite,
  nodesOverlapInModel,
  resizeComposite,
  subtreeNodeIds,
  visualBox,
} from "./layout-model";

describe("layout-model utilities", () => {
  const inputs = [
    { id: "root", isCompound: true },
    { id: "child", parent: "root", footprint: { halfW: 10, halfHTop: 10, halfHBottom: 10 } },
    { id: "grand", parent: "child", footprint: { halfW: 5, halfHTop: 5, halfHBottom: 5 } },
  ];

  const layout = {
    root: { x: 0, y: 0, w: 300, h: 200 },
    child: { x: 20, y: 10 },
    grand: { x: 5, y: 5 },
  };

  it("reports ancestry and subtree membership", () => {
    const model = buildLayoutModel(inputs, layout);
    expect(isAncestor(model, "root", "grand")).toBe(true);
    expect(isAncestor(model, "child", "root")).toBe(false);
    expect(subtreeNodeIds(model, "root").sort()).toEqual(["child", "grand", "root"].sort());
  });

  it("flatLayoutFromModel round-trips compound sizes", () => {
    const model = buildLayoutModel(inputs, layout);
    const flat = flatLayoutFromModel(model);
    expect(flat.root.w).toBe(300);
    expect(flat.child.x).toBeCloseTo(20, 3);
  });

  it("moveComposite translates descendants", () => {
    const model = buildLayoutModel(inputs, layout);
    const before = absoluteCenter(model, "grand");
    const moved = moveComposite(model, "root", { x: 40, y: -10 });
    const after = absoluteCenter(moved, "grand");
    expect(after.x - before.x).toBeCloseTo(40, 3);
    expect(after.y - before.y).toBeCloseTo(-10, 3);
  });

  it("canOverlap is true for the same node id", () => {
    const model = buildLayoutModel(inputs, layout);
    expect(canOverlap(model, "child", "child")).toBe(true);
  });

  it("isAncestor is false for unrelated nodes", () => {
    const model = buildLayoutModel(
      [
        { id: "a", isCompound: true },
        { id: "b", isCompound: true },
      ],
      {
        a: { x: 0, y: 0, w: 100, h: 100 },
        b: { x: 200, y: 0, w: 100, h: 100 },
      },
    );
    expect(isAncestor(model, "a", "b")).toBe(false);
  });

  it("canOverlap is true for ancestor/descendant pairs", () => {
    const model = buildLayoutModel(inputs, layout);
    expect(canOverlap(model, "child", "root")).toBe(true);
    expect(canOverlap(model, "root", "grand")).toBe(true);
    expect(canOverlap(model, "child", "missing")).toBe(false);
  });

  it("visualBox and nodesOverlapInModel detect leaf intersection", () => {
    const overlapping = buildLayoutModel(
      [
        { id: "root", isCompound: true },
        { id: "a", parent: "root", footprint: { halfW: 20, halfHTop: 20, halfHBottom: 20 } },
        { id: "b", parent: "root", footprint: { halfW: 20, halfHTop: 20, halfHBottom: 20 } },
      ],
      {
        root: { x: 0, y: 0, w: 400, h: 400 },
        a: { x: 0, y: 0 },
        b: { x: 5, y: 0 },
      },
    );
    expect(visualBox(overlapping, "a")).not.toBeNull();
    expect(nodesOverlapInModel(overlapping, "a", "b")).toBe(true);
  });

  it("resizeComposite no-ops for missing compound metadata", () => {
    const model = buildLayoutModel([{ id: "leaf" }], { leaf: { x: 0, y: 0 } });
    const next = resizeComposite(model, "leaf", "se", 10, 10);
    expect(next).toEqual(model);
  });

  it("resizeComposite applies default constraints when omitted", () => {
    const model = buildLayoutModel(
      [
        { id: "parent", isCompound: true },
        { id: "child", parent: "parent", footprint: { halfW: 10, halfHTop: 10, halfHBottom: 10 } },
      ],
      {
        parent: { x: 0, y: 0, w: 200, h: 200 },
        child: { x: 0, y: 0 },
      },
    );
    const resized = resizeComposite(model, "parent", "se", 30, 20);
    const outer = visualBox(resized, "parent");
    expect(outer!.x2 - outer!.x1).toBeGreaterThan(200);
  });

  it("resizeComposite supports every corner handle", () => {
    const model = buildLayoutModel(
      [
        { id: "parent", isCompound: true },
        { id: "child", parent: "parent", footprint: { halfW: 10, halfHTop: 10, halfHBottom: 10 } },
      ],
      {
        parent: { x: 0, y: 0, w: 200, h: 200 },
        child: { x: 0, y: 0 },
      },
    );
    for (const corner of ["nw", "ne", "sw", "se"] as const) {
      const resized = resizeComposite(model, "parent", corner, 15, 15);
      expect(visualBox(resized, "parent")).not.toBeNull();
    }
  });

  it("moveChild clamps inside parent interior", () => {
    const model = buildLayoutModel(
      [
        { id: "parent", isCompound: true },
        { id: "child", parent: "parent", footprint: { halfW: 10, halfHTop: 10, halfHBottom: 10 } },
      ],
      {
        parent: { x: 0, y: 0, w: 200, h: 200 },
        child: { x: 0, y: 0 },
      },
    );
    const moved = moveChild(model, "child", { x: 500, y: 500 });
    const absolute = absoluteCenter(moved, "child");
    expect(absolute.x).toBeLessThan(500);
    expect(absolute.y).toBeLessThan(500);
  });

  it("nodesOverlapInModel returns false for unknown nodes", () => {
    const model = buildLayoutModel([{ id: "solo" }], { solo: { x: 0, y: 0 } });
    expect(nodesOverlapInModel(model, "solo", "missing")).toBe(false);
  });
});
