# 03 — Convergence: the loop

## Job

Run one decomposed unit from *started* to *merged/done*. This is the *contract* phase: implement →
verify → review → converge. It is the layer that can run unattended.

## The stateless tick

The loop's state machine lives **outside the agent**. Every tick:

1. Re-derive the current state from the source of truth (open PRs, review threads, CI status,
   issue tracker) — never from the previous tick's memory.
2. Take exactly **one** action for the highest-priority state:
   - unresolved review feedback → fix, run quality gates, push, reply, re-request review
   - approved and mergeable → let the designated merger act (see gates below)
   - merged → close out the unit, start the next child
   - nothing actionable → sleep (paced to the cost model of the runtime, e.g. cache TTLs)
3. Record the tick and its outcome as telemetry events (chapter 05).

Stateless ticks buy: crash/interrupt tolerance, parallel agents without coordination, and the
ability to swap the agent runtime (Claude ↔ Codex) mid-loop.

## Verification gates

A unit converges only through gates, in increasing order of independence:

1. **Mechanical**: typecheck, tests, lint, build — run by the maker before every push.
2. **Independent checker**: a reviewer that is *not the maker* — bot reviewer, another model, or a
   human. The maker never approves its own work.
3. **Merge authority**: whoever/whatever the repository designates (human approvals, auto-merge
   bot). The loop *discovers* the repo's merge mechanism before starting; it never assumes it.

## Stop lines

Enumerated, named conditions where the loop halts and escalates instead of proceeding:

- irreversible or outward-facing actions not covered by prior approval (deploys, deletions,
  force-push over others' work)
- unverifiable contracts about to be shipped as fact
- repeated non-convergence (review rounds beyond a threshold, permanently red CI, conflicts with
  humans' unmerged work)
- any credential/PII boundary

A stop-line hit is recorded as an event — it is simultaneously a safety mechanism and a signal
that the tree has a hole (chapter 04).

## Pacing

Unattended loops poll. Pacing is a cost decision: short intervals only while an external response
is imminent; long intervals when idle. The pacing policy belongs to the loop definition, not the
agent's mood.
