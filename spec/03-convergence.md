# 03 — Convergence: the loop

## Job

Run one decomposed unit from *started* to *merged/done*. This is the *contract* phase: implement →
verify → review → converge. It is the layer that can run unattended.

## Vocabulary this layer contributes

These are the nouns telemetry (chapter 05) counts; they must stay stable even as the machinery
that implements them changes.

- **Tick.** One stateless iteration: re-derive the current state from the source of truth (open
  PRs, review threads, CI status, issue tracker — never the previous tick's memory), take exactly
  one action for the highest-priority state, record the outcome as an event. Statelessness buys
  crash/interrupt tolerance, parallel agents without coordination, and the ability to swap the
  agent runtime mid-loop.
- **Gate.** A verification a unit must pass to converge, in increasing order of independence:
  *mechanical* (typecheck, tests, lint, build — run by the maker before every push),
  *independent checker* (a reviewer that is not the maker; the maker never approves its own work),
  *merge authority* (whoever/whatever the repository designates — discovered, never assumed).
- **Stop line.** An enumerated, named condition where the loop halts and escalates instead of
  proceeding: irreversible or outward-facing actions not covered by prior approval, unverifiable
  contracts about to ship as fact, repeated non-convergence, any credential/PII boundary. A
  stop-line hit is recorded as an event — simultaneously a safety mechanism and a return-path
  signal (chapter 04).

## Where this lives

The loop engine is **executable behavior** — it lives in skills, hooks, and automations, not in
this spec. Executable definitions have an automatic write path: they are exercised every run and
edited when they fail, whereas a prose procedure describing the same loop drifts silently
(chapter 00). Tick scheduling, pacing policy, and the action priority order are properties of each
loop's definition in the host system.

fukuro keeps the nouns because they are the schema of measurement: ticks, gate outcomes, and
stop-line hits are the events chapter 05 counts, and the return path reads them regardless of
which engine emitted them. Which stop lines a given loop enforces is itself recorded in the
user-owned entity directory (chapters 00 and 04), not in this spec.
