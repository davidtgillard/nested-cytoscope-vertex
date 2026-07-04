# Toy nested Cytoscape compound resize

Minimal reproduction harness for bellman-gui compound resize behaviour. It models the bundled example setup:

- **Parent compound:** `wp-invoicing`
- **Inner nodes:** `wp-pdf-export`, `wp-email-export`

Use this repo to iterate on layout/sync fixes without running the full Tauri app.

## Quick start

```bash
cd ~/src/toy-nested-cytoscope-example.git
npm install
npm run dev
```

Open http://localhost:5174

## What to try

1. Drag a corner resize handle on `wp-invoicing`.
2. Drag either child node inside the compound.
3. Watch **Child absolute delta** in the right panel — it should stay at `0` during resize. Any non-zero value means inner nodes moved in graph space.

Use **Reset graph** to rebuild Cytoscape from scratch.

## Code map

| File | Role |
|------|------|
| `src/lib/compound-graph.ts` | `GraphParentVertex` / `GraphChildVertex` domain API |
| `src/lib/layout-model.ts` | Domain model + `resizeComposite` (ported from bellman-gui) |
| `src/lib/cytoscape-sync.ts` | `applyLayoutModelToCy` |
| `src/lib/cytoscape-utils.ts` | `compoundAbsolutePosition`, measure/pin helpers, debug snapshots |
| `src/lib/cytoscape-theme.ts` | Stylesheet (compound padding, min-width bias) |
| `src/App.tsx` | Graph UI, resize handles, debug panel |

## Tests

```bash
npm test
```

## Relation to bellman-gui

When a fix works here, port the same change to:

- `src/lib/cytoscape-layout-sync.ts` (`applyLayoutModelToCy`)
- `src/components/RoadmapGraph.tsx` (`measureCompoundSizes`)
- `src/components/CompoundResizeHandles.tsx`
