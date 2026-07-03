# Toy nested Cytoscape compound resize

Minimal reproduction harness for bellman-gui compound resize behaviour. It models the bundled example setup:

- **Parent compound:** `wp-invoicing`
- **Inner node:** `wp-pdf-export` (single child)

Use this repo to iterate on layout/sync fixes without running the full Tauri app.

## Quick start

```bash
cd ~/src/toy-nested-cytoscope-example.git
npm install
npm run dev
```

Open http://localhost:5174

## What to try

1. Leave **Scenario** on *Measured* (matches bundled example: no saved `w`/`h`, size measured after layout).
2. Drag a corner resize handle on `wp-invoicing`.
3. Watch **Child absolute delta** in the right panel — it should stay at `0`. Any non-zero value means inner nodes moved in graph space.

### Toolbar controls

| Control | Purpose |
|---------|---------|
| **Scenario** | `Measured` = auto-pin like bundled example; `Preset sized` = layout includes 420×280 |
| **Cy sync mode** | Compare bellman sync strategies (see `src/lib/cytoscape-sync.ts`) |
| **Resize timing** | `Live` = sync every move; `Deferred` = model-only during drag, one Cy sync on release |
| **Measure pinning** | Whether initial `applyFrozenCompoundSize` restores child absolute positions |
| **Reset graph** | Rebuild Cytoscape from scratch |

## Code map

| File | Role |
|------|------|
| `src/lib/layout-model.ts` | Domain model + `resizeComposite` (ported from bellman-gui) |
| `src/lib/cytoscape-sync.ts` | `applyLayoutModelToCy` with sync mode switch |
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
