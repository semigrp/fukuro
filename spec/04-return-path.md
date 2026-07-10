# 04 — The return path (復路 / fukuro)

## Job

Improve the system itself — the tree, the skills, the loop definitions — using signals produced by
the outbound path. This is the namesake layer and the one most systems skip.

## The cycle

1. **Collect signals**: stop-line hits, unrouted work (no matching branch), repeated manual
   patterns, low-scoring or stale skills, telemetry regressions (chapter 05).
2. **Select one improvement.** Exactly one per cycle: the change with the highest expected effect
   that is executable now. Batch improvements hide which change caused which effect.
3. **Apply it**: edit a skill, add a branch, prune a duplicate, tighten a stop line.
4. **Verify against the baseline. Only improvements survive.** If the baseline degrades, revert.

## Baselines: rubric vs outcome

Two kinds of baseline, used together:

- **Rubric scores** (structured self-assessment on fixed axes) are cheap and directional, but they
  saturate — a mature system scores near the ceiling on its own rubric — and they are self-graded,
  which reintroduces the maker-as-checker problem the outbound path already solved.
- **Outcome metrics** are the ground truth: review rounds per merged PR, lead time, ticks per
  merge, stop-line hits, human interventions. A skill change *survives* only if the next N units'
  outcomes do not regress.

Rule: rubrics diagnose (*which axis is weakest?*), outcomes decide (*does the change stay?*).

## Independence

The evaluator of a change should not be its author. Practical options, in increasing strength:
a different model family scoring the change; an adversarial reviewer prompted to refute it;
outcome metrics over subsequent units (fully independent, but slow). Use the fast ones to filter,
the slow one to confirm.

## The vocabulary itself is a return-path target

The nouns the outbound chapters contribute — which loops exist, which hypotheses are open, which
stop lines are enforced — live in a user-owned entity directory (chapter 00), and the return path
is what maintains it. Telemetry proposes entity creation and pruning: recurring unrouted work
proposes a new loop entity; a stop line that never fires (or fires constantly) proposes pruning or
tightening; a hypothesis with no events since it opened proposes closing or re-scoping. The cycle
above applies unchanged — one proposal per cycle, verified against baselines, destructive edits
gated by human approval.

This is what keeps the delegation in chapter 00 honest: the structures fukuro no longer owns are
still observed, and the entity files' write path is the return path itself — automatic by
construction, not by discipline.

## Failures are seeds

Every stop-line hit and every "no branch matched" is recorded, not just survived. The return path
reads these records as a queue of candidate branches and repairs. A system whose failure log is
empty is not safe — it is unobserved.

## Guard rails

- Never let a self-improvement cycle degrade the baseline and stay.
- Destructive maintenance (merging, archiving, deleting branches of the tree) requires human
  approval.
- The return path edits *the system*, not the workload: it must not ship product changes as a
  side effect.
