# ADR 0003: Store decomposition DAGs in the issue tracker

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

A routed goal must be split into units that are small enough to verify and ordered by real
dependencies. Verification quality, human review depth, CI signal, and reviewer usefulness degrade
non-linearly as diffs grow. Comparable unit sizes are also required for meaningful per-unit
telemetry.

Decomposition state changes as work is filed, linked, unblocked, and closed. The issue tracker
already participates in those actions, whereas a parallel Fukuro plan store would need separate
upkeep.

## Decision

Store decomposition instances as dependency DAGs in the issue tracker. Fukuro does not own a
parallel DAG or prescribe tracker-specific approval, linking, or re-splitting mechanics.

Use the following doctrine:

- **Parent equals plan:** the parent contains self-contained background, completion criteria,
  exclusions, and the dependency graph over its children. A reader can understand the plan
  without following another link.
- **Child equals one verifiable unit:** one child maps to one PR. Target approximately 100 changed
  lines and treat approximately 200 changed lines as the ceiling, excluding generated files. Each
  child carries acceptance criteria and a human-executable verification procedure.
- **Dependencies are explicit:** independent children can run in parallel; dependent children
  form a declared stack. Do not create a child on top of an unverifiable contract.

Verifiability, rather than component boundaries or desired parallelism, decides the scope of a
child.

## Consequences

- Filing, linking, and closing work automatically maintain the decomposition source of truth.
- The issue tracker must support or encode parent-child and dependency relationships clearly.
- The size thresholds are doctrine rather than an unconditional mechanical limit; generated code
  and exceptional work may need explicit treatment.
- Convergence gates remain useful because units stay reviewable, and telemetry can compare units
  without hiding large scope differences.
- Tracker-specific workflows remain outside Fukuro and may vary between installations.
