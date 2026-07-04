# @dgillard/nested-cytoscope-vertex

TypeScript library for nested compound graphs in Cytoscape. The core API is {@link GraphParentVertex}: a compound parent that owns leaf children, keeps an authoritative layout model, and syncs to Cytoscape while preserving child absolute positions during resize.

## Install

```bash
npm install @dgillard/nested-cytoscope-vertex cytoscape
```

## Quick start

```ts
import cytoscape from "cytoscape";
import {
  GraphParentVertex,
  createCompoundGraphStylesheet,
} from "@dgillard/nested-cytoscope-vertex";

const parent = GraphParentVertex.create({
  id: "wp-invoicing",
  label: "wp-invoicing",
  color: "#64748b",
  children: [
    { id: "wp-pdf-export", label: "wp-pdf-export", color: "#94a3b8", x: -60, y: 0 },
  ],
});

const cy = cytoscape({
  container: document.getElementById("graph")!,
  style: createCompoundGraphStylesheet(),
  elements: parent.buildElements(),
  layout: { name: "preset", fit: true, padding: 40 },
});

cy.ready(() => {
  parent.initializeFromCy(cy);
  parent.attachChildDragHandlers(cy, { onMove: () => {} });
  parent.attachParentDragHandlers(cy, { onChange: () => {} });
});
```

## Demo app

Manual test harness (not published):

```bash
npm install
npm run dev
```

Open http://localhost:5174

## Development

```bash
npm install          # install all workspaces
npm run build        # build library + demo
npm test             # run library tests
npm run test:coverage
npm run docs         # generate API docs → docs/api/
npm run attw         # build + TypeScript declaration check
```

## Release (manual)

1. Bump `version` in `packages/nested-cytoscope-vertex/package.json`
2. Update `packages/nested-cytoscope-vertex/CHANGELOG.md`
3. From repo root:

```bash
npm run build
npm run test:coverage
npm run docs
npm run attw
cd packages/nested-cytoscope-vertex
npm publish --access public
```

## API documentation

Generated TypeDoc output lives in [`docs/api/`](docs/api/) after `npm run docs`.

## Monorepo layout

| Path | Role |
|------|------|
| `packages/nested-cytoscope-vertex/` | Publishable library |
| `apps/demo/` | Vite + React manual test harness |

## Relation to bellman-gui

This repo extracts and validates compound resize behaviour from bellman-gui. When a fix works here, port the same change back to the main app.
