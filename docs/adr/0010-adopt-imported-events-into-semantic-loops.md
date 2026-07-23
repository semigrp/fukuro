# ADR 0010: Adopt imported events into semantic loops by declared amendment

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

`fukuro import` derives `loop_id` as `<source>:<subject.id>` (ADR 0006 keeps imported rows
immutable and idempotent). Harness-captured events (pr_opened, merged) therefore land in
session-scoped loops, while the work they belong to lives in a semantic loop. Attribution has
been repaired by hand-written backfills — a double ledger with no idempotency guarantee.

## Decision

Add `fukuro adopt`, which copies selected events from a source loop into a target loop as
declared amendments. Original rows are never modified or deleted; each adopted row keeps the
original event time, carries `data.backfill = true`, and names its provenance with
`adopted_from` (source loop) and `adopted_row` (source row id). Adoption is idempotent on
(target loop, adopted_row).

## Consequences

- Re-attribution becomes one auditable command instead of hand-crafted backfills.
- Readers need no changes: adopted rows pair with lifecycles through the existing
  declared-amendment convention.
- The double ledger stays visible by design: the session loop keeps its raw capture, the
  semantic loop gains an attributed copy that names its origin.
