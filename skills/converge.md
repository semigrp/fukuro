---
name: fukuro-converge
description: Run one decomposed unit from started to merged through stateless ticks. Re-derives state from the source of truth every tick, takes exactly one action, converges only through gates, and escalates instead of improvising. Parameterized by bootstrap-discovered facts (gates, reviewers, merge authority) — distilled from real loop runs. Use while driving any unit to done.
---

# converge — the stateless tick (meta-skill)

Convergence is the *contract* phase ([ADR 0004](../docs/adr/0004-run-convergence-as-stateless-gated-ticks.md)):
one unit travels implement → verify → review → merged. This skill is the generic discipline; the
unit and the machinery (gates, reviewers, merge authority) arrive from your bootstrap-generated
loop definition. As with every meta-skill here, the rules exist because real runs failed in
specific ways; each is a scar.

## The tick

State lives **outside the agent** — in the tracker, the PR, CI, and the event log. Every tick:

1. **Re-derive the current state** from the source of truth (`fukuro ctx`, open PRs, review
   threads, CI status). Never trust the previous tick's memory: a review may have landed, CI may
   have flipped, a human may have pushed.
2. Take exactly **one action** for the highest-priority state:
   - unresolved review feedback → fix, run gates, push, reply, re-request review
   - red CI on your PR → reproduce locally, fix, run gates, push
   - approved and mergeable → let the designated merge authority act (never assume you are it)
   - merged → close out (`merged`, `issue_closed`), start the next child
   - nothing actionable → record an idle `tick` and sleep
3. Record the tick (`fukuro log-event tick --data '{"action":...}'`) so the return path can count
   ticks-per-merge later.

One action per tick is what keeps failures attributable: when a tick does three things and the
loop regresses, you no longer know which one did it.

## Gates: run them bare, read the exit code

Mechanical gates (typecheck, tests, lint — whatever bootstrap discovered) run **before every
push**, no exceptions for "trivial" diffs. The recurring failure is not skipping gates but
**defeating them accidentally**:

- **Never pipe a gate.** `test | tail`, `test | grep` return the *pipe's* exit code, not the
  gate's — the gate fails and the loop reads success. *(scar: this exact mistake shipped a failing
  test and a lint violation on the same day, in two different loops — the lesson replays because
  piping is a reflex.)* Run the gate bare and check its exit code; if you must filter output, use
  `set -o pipefail` or capture to a file and inspect afterwards.
- A gate that was green last tick is not green now. Gates are re-run after every change, not
  remembered.

## Escalation is a state, not a failure

Two situations end a tick with a recorded event instead of an action:

- **The review machinery asks for a human.** A reviewer (bot or person) may explicitly request
  human verification — e.g. a UI change escalated for visual sign-off that no gate can replace.
  Do not argue with it, work around it, or self-approve: record `human_intervention` with what is
  awaited, notify the human, and let the loop idle on this unit. *(scar: an auto-merge flow
  correctly refused a global UI change until a human looked at the rendered preview.)*
- **The next step needs access you don't have.** Production data, privileged logins, credentials.
  Record `human_intervention` naming exactly what is needed and the smallest artifact that
  unblocks (one query result, one exported table). *(scar: a unit stalled on real ID mappings
  obtainable only through a privileged console; naming the exact 11-row need got it unblocked in
  one exchange.)*

A stop-line hit is the third variant: a named forbidden condition from your loop definition
(irreversible actions without approval, credential/PII boundaries, repeated non-convergence).
Record `stop_line_hit --data '{"line":...,"cause":...}'` and halt the unit — the event is
simultaneously a brake and a signal that the tree has a hole
([ADR 0005](../docs/adr/0005-own-a-measured-return-path.md)).

## Pacing

Polling cadence is a cost decision, not a mood. Short intervals only while an external response is
imminent (CI running, review requested moments ago); long intervals when idle. If your runtime has
a context-cache TTL, pace against it — sleeping just past the TTL pays the worst rate. The policy
belongs in your loop definition; converge just obeys it.

## Telemetry wiring

See [ADR 0006](../docs/adr/0006-use-an-append-only-local-telemetry-store.md) and
[ADR 0007](../docs/adr/0007-model-exploration-with-typed-units.md).

`loop_start` when the unit begins → `tick` per cycle → `pr_opened` → `review_round` per
reviewer-response boundary → `merged` / `issue_closed` → `loop_end`. Findings and hypotheses
discovered mid-loop are recorded when found, not batched to the end — an unrecorded observation
does not survive the tick boundary.

## Stop lines for this skill itself

- Acting on remembered state instead of re-deriving → stop, re-derive.
- Pushing without running gates, or reading a piped gate's exit code → stop, run bare.
- Merging (or nudging a merge) when you are not the designated authority → stop.
- Working around a reviewer's explicit human-verification request → stop, escalate.
- More than one state-changing action in a tick → stop, pick the highest-priority one.
