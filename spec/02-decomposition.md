# 02 — Decomposition: the DAG

## Job

Turn a routed goal into units small enough to verify, ordered by real dependencies. This is the
*expand* phase: one goal → one parent plan → N child units.

## Vocabulary this layer contributes

- **Parent = plan.** Self-contained background (why / what / what *not* to build), completion
  criteria, and the dependency graph over its children. A reader should understand the plan
  without following any link.
- **Child = one verifiable unit.** One child ↔ one PR, target diff ≈ 100 lines (hard ceiling
  ≈ 200, excluding generated files), carrying its own acceptance criteria and a human-executable
  verification procedure.
- **Explicit dependencies.** Independent children run in parallel; dependent children form a
  declared stack. Verifiability decides scope: a child built on an unverifiable contract is not
  cut.

## Why the size limit is load-bearing

Small units are not a style preference. Verification quality — human review depth, CI signal,
bot-review usefulness — degrades non-linearly with diff size. The size cap is what keeps the
convergence layer's gates (chapter 03) meaningful, and it is what makes throughput measurable
(chapter 05): units become comparable.

## Where this lives

Decomposition instances live in the **issue tracker**. That is design principle 1 (state lives
outside the model) applied to plans: filing, linking, and closing issues happen as a side effect
of doing the work, so the DAG never depends on separate upkeep. fukuro does not own the DAG and
does not prescribe how to operate the tracker — approval flows, linking conventions, and re-split
mechanics belong to the tracker and the loops that drive it.

fukuro keeps the unit-size doctrine because the rest of the spec assumes it: chapter 03's gates
assume reviewable units, and chapter 05's per-unit metrics assume comparable ones.
