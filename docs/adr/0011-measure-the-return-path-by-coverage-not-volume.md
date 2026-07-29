# ADR 0011: Measure the return path by coverage, not volume

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

Two measurement faults surfaced together in a real 22-day ledger.

First, `report` pooled every row regardless of origin. Once a harness adapter began importing
session telemetry (ADR 0010, `import`), imported rows outnumbered hand-written ones roughly
3.5:1. They buried the ranked kind list, and — worse — they inflated attribution coverage to a
flat 100%: an imported row carries `session` because the importer stamps it and `loop_id`
because the contract derives it from `subject`. The KPI reported the importer's bookkeeping, not
the loop's discipline, so it read the same whether the operator attributed anything or not.

Second, an attempt to measure the return path as a share of all events (return-path kinds over
forward-path kinds) fell from 40% to 13% over four weeks. Read naively it says learning
collapsed. It does not: over the same period, corrections that actually fired — a human stepping
in, a stop line tripping — were followed by a recorded finding or repair 50–100% of the time.
The share fell because delivery volume quadrupled while the number of corrections did not.

A share metric is actively harmful here. It falls whenever the loop ships faster, and the
cheapest way to raise it is to log findings nothing asked for. That rewards exactly the padding
the anti-slop convention (issue #12) exists to prevent.

## Decision

**Report origin separately, and attribute only what this machine wrote.** A row is imported iff
`data.sourceEventId` is present — `import` always stamps it and `log-event` never does.
`data.source` alone is not a discriminator: a hand-written finding may legitimately record its
own provenance under that key. `report` lists kinds under "written here" and "imported"
separately, keeps the pooled totals in `events_by_kind`, and computes every attribution ratio
over directly-written rows only. The excluded count is printed next to the KPI, so the narrowed
basis is visible rather than silent.

**Measure the return path as correction follow-through, never as a share of events.** For each
correction (`human_intervention`, `stop_line_hit`), ask whether its *own loop* produced a
return-path event (`finding`, `improve_applied`, `decision_made`, `concept_captured`,
`procedure_defined`, `hypothesis_opened`) within 7 days. A correction younger than that window
is reported as pending, not as a miss; one with no `loop_id` cannot be paired either way and is
counted separately. The denominator is the set of signals that actually fired, so the only way
to raise the number is to answer one.

**Surface unanswered corrections as obligations.** Two `PAIR_RULES` entries (`correction`,
`stop-line`) put them in the open ledger, where `ctx` shows them once stale like any other
forgotten obligation. No new query code: the pair table already derives this shape.

## Consequences

- Attribution stops flattering itself. On the ledger that motivated this, session coverage moved
  from a meaningless 100% to a real 98%, and the direct kind list became readable again.
- The return path has a KPI that cannot be gamed by writing more events, and a stale-obligation
  entry that names the specific correction still owing an answer.
- The pooled `events_by_kind` totals stay in the JSON summary, so existing consumers keep working.
- A correction answered in a *different* loop reads as unanswered. That is deliberate — an answer
  filed elsewhere is not this correction's answer — but it means loop hygiene now affects the KPI.
