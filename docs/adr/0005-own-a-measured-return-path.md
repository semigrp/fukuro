# ADR 0005: Make the measured return path Fukuro's responsibility

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Routing, decomposition, and convergence produce workload output, but they do not by themselves
improve the system that produced it. Most agent stacks have no explicit owner for turning routing
gaps, stop-line hits, repeated manual work, stale skills, and telemetry regressions into verified
harness improvements.

Self-assessment rubrics are cheap and directional, but mature systems can saturate their own
rubrics, and self-grading recreates the maker-as-checker problem. Outcome evidence is slower but
independent of the author's opinion.

## Decision

Fukuro owns the doctrine and measurement of the return path. Run one improvement per cycle:

1. Collect signals: stop-line hits, unrouted work, repeated manual patterns, low-scoring or stale
   skills, and telemetry regressions.
2. Select exactly one executable improvement with the highest expected effect.
3. Apply it by changing a skill, routing destination, duplicated structure, or stop line.
4. Verify it against the baseline. Revert it if the baseline degrades.

The invariant is **only improvements survive**. Apply rubrics to diagnose which axis is weak and
outcome metrics to decide whether a change stays.

The evaluator should not be the author. Fast filters may use another model family or an
adversarial reviewer; outcome metrics over subsequent units provide the slower independent check.

The return path also maintains proposals for the user-owned entity vocabulary. Recurring unrouted
work can propose a loop entity; a stop line that never fires or fires constantly can propose
pruning or tightening; a hypothesis with no events can propose closure or re-scoping. Apply one
proposal per cycle, measure it, and require human approval for destructive changes. Fukuro does
not write the entity directory automatically.

## Consequences

- Every failure and routing gap becomes a candidate improvement rather than disappearing after
  recovery. An empty failure log means the system may be unobserved, not necessarily safe.
- Single-change cycles preserve causal attribution but limit how many improvements can be tested
  at once.
- Outcome confirmation requires a later observation window, so some changes remain provisional
  after the fast review passes.
- Destructive maintenance, including merging, archiving, or deleting entities, requires human
  approval.
- A return-path cycle may edit the harness but must not ship product workload as a side effect.
- The telemetry contract in [ADR 0006](0006-use-an-append-only-local-telemetry-store.md) is
  load-bearing: without measured baselines, the return path cannot enforce its invariant.
