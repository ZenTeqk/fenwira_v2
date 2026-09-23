# ADR-0009: React Flow for the automation builder

**Status:** Accepted

## Context

Phase 10 needs a node-graph editor with custom nodes, branching edges, pan and zoom, a minimap, and selection.

## Decision

`@xyflow/react` (React Flow) with custom node components built from `@fenwira/ui` tokens. The server stores our own `FlowGraph` JSON, not React Flow internals. Conversion happens at the UI boundary. Auto-layout uses `dagre` (or `elkjs` if dagre proves insufficient).

## Consequences

- A mature, well-documented canvas, so we build only the node UIs and config forms.
- A storage format that is independent of the library, so the library could be replaced.

## Alternatives rejected

- **A custom canvas:** high cost, with no differentiation.
- **Rete.js / JointJS:** smaller React ecosystem, or commercial licensing.
