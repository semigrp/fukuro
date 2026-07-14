# ADR 0004: Run convergence as stateless, gated ticks

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Each decomposed unit needs to move from started to merged or done through implementation,
verification, review, and convergence. Long-running agents can be interrupted, replaced, or run
in parallel. Remembered conversational state cannot safely be the control plane.

The loop procedure must also remain synchronized with what actually executes. Prose procedures
that duplicate skills, hooks, and automations drift because they are not exercised on every run.

## Decision

Implement convergence as executable behavior in host-system skills, hooks, and automations. Do not
make this ADR or Fukuro itself the loop engine.

Use these stable concepts as the measurement contract:

- **Tick:** one stateless iteration. Re-derive current state from sources of truth such as open
  PRs, review threads, CI, the issue tracker, and the event log; take exactly one action for the
  highest-priority state; record the outcome. Never derive a tick from the previous tick's memory.
- **Gate:** a verification a unit must pass, in increasing order of independence: mechanical
  checks run by the maker before every push, an independent checker that is not the maker, and the
  repository's discovered merge authority.
- **Stop line:** an enumerated, named condition that halts and escalates instead of improvising.
  Examples include unapproved irreversible or outward-facing actions, unverifiable contracts
  about to ship as fact, repeated non-convergence, and credential or PII boundaries. Record each
  hit as an event.

Tick scheduling, pacing, action priority, concrete gates, and concrete stop lines belong to each
host loop definition. Loop, hypothesis, and stop-line entities referenced by telemetry live in the
user-owned entity directory defined by [ADR 0006](0006-use-an-append-only-local-telemetry-store.md).

## Consequences

- Loops tolerate interruption and runtime replacement because every tick reconstructs its state.
- Parallel agents can operate without hidden shared memory, subject to the concurrency controls of
  the external systems they mutate.
- One action per tick improves attribution but may reduce raw throughput for tightly coupled work.
- Maker, checker, and merge authority are distinct roles; repositories must discover and configure
  their actual actors.
- Fukuro measures ticks, gates, and stop lines but cannot execute or enforce a host's convergence
  policy by itself.
