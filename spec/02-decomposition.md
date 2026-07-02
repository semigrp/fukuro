# 02 — Decomposition: the DAG

## Job

Turn a routed goal into units small enough to verify, ordered by real dependencies. This is the
*expand* phase: one goal → one parent plan → N child units.

## Structure

- **Parent = plan.** Self-contained background (why / what / what *not* to build), completion
  criteria, and the dependency graph over its children. A reader should understand the plan
  without following any link.
- **Child = one verifiable unit.** One child ↔ one PR, target diff ≈ 100 lines (hard ceiling
  ≈ 200, excluding generated files). Each child carries its own acceptance criteria and a
  human-executable verification procedure.
- **Dependencies are explicit.** Independent children run in parallel (worktrees); dependent
  children form a stack with declared base branches and rebase strategy.

## Rules

1. **Verifiability decides scope.** If a contract (API shape, data source) cannot be verified,
   do not cut a child that assumes it. Speculative contracts are the top source of wasted loops.
2. **Approval gate before fan-out.** Creating N issues/PRs is outward-facing and semi-irreversible.
   The decomposition (titles, sizes, dependency order) is reviewed by a human *before* anything is
   filed.
3. **Bidirectional links.** Child → plan (the unit knows why it exists) and plan → children
   (the plan tracks completion). Automation keywords that close issues (`Closes #N`) are written
   only when closure is intended — they fire from anywhere in a merged description.
4. **Re-split on breach.** A child that grows past the ceiling, or turns out to span two surfaces
   (two screens, two services), is split rather than shipped big.

## Why the size limit is load-bearing

Small units are not a style preference. Verification quality — human review depth, CI signal,
bot-review usefulness — degrades non-linearly with diff size. The size cap is what keeps the
convergence layer's gates (chapter 03) meaningful, and it is what makes throughput measurable
(chapter 05): units become comparable.
