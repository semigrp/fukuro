# ADR 0006: Use an append-only, local-first telemetry store

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Issue trackers and PRs answer *"where was I?"* but do not answer *"is the system getting better?"*.
The return path needs durable outcome evidence that any agent runtime can record and that does not
depend on a hosted telemetry service.

The history itself is evidence. Mutable status would erase corrections and make later analysis
depend on the latest writer's interpretation. Telemetry must also avoid blocking the work it is
observing.

## Decision

Use one local SQLite database as an append-only, agent-agnostic event log. Any runtime can write
through the zero-dependency CLI from hooks, automations, or CI. Synchronization and remote export
are outside the storage contract.

### Event model

Store one `events` table with `ts`, `session`, `loop_id`, `issue`, `pr`, `kind`, and JSON `data`.
The executable schema is [`cli/schema.sql`](../../cli/schema.sql).

Canonical event kinds are:

| Kind | Emitted when |
|---|---|
| `loop_start` / `loop_end` | a convergence loop begins or finishes a parent goal |
| `tick` | one stateless tick executes |
| `pr_opened` | a child unit's PR is created |
| `review_round` | one push responds to reviewer feedback |
| `merged` | a PR is merged |
| `issue_closed` | a child unit closes |
| `stop_line_hit` | the loop halts on the named `data.line` |
| `human_intervention` | a human must act for the loop to proceed |
| `improve_applied` / `improve_reverted` | a return-path change is retained or rolled back |
| `tokens` | a cost sample is recorded in `data.count` and `data.model` |
| `concept_captured` | a phenomenon is named and defined |
| `hypothesis_opened` | a testable claim opens with its closing condition |
| `hypothesis_confirmed` / `hypothesis_refuted` | a hypothesis closes with evidence |
| `procedure_defined` | a repeatable procedure is recorded |
| `finding` | an untyped discovery is worth retaining |

Unknown kinds are accepted with a warning. Telemetry strictness must not stop a running loop.

Set `FUKURO_SESSION` in the environment that launches an agent and let harness hooks emit
mechanical events. Context derivation fills loop, issue, and PR fields; manual flags are overrides.
Hook recipes are documented in [`docs/hooks.md`](../hooks.md).

One `review_round` means one push that responds to reviewer feedback, regardless of the number of
commits or replies it contains. Fix-up pushes for mistakes caught while responding belong to the
same round. The metric counts reviewer-driven iterations, not pushes.

### Corrections remain append-only

Never edit or delete a wrong event. Append a correction:

- `data.backfill: true` marks an event written after it happened. Ordering-sensitive checks use
  `ts`, with row id only as a tie-breaker, and honor the marker when a current timestamp had to be
  retained.
- `data.supersedes: <event id>` or `data.re_record: true` marks a replacement event. Count-based
  checks exclude the correcting row from duplicate tallies. Prefer `supersedes` when the original
  id is known.

Consumers must honor these markers. An unmarked duplicate or out-of-order close remains a lint
warning. Both the original and correction remain auditable.

### Entity-directory contract

`$FUKURO_ONTOLOGY` is an opt-in pointer to a plain Markdown directory owned by the user. Fukuro
validates references and writes nothing.

- Use `loop/`, `hypothesis/`, and `stop-line/` subdirectories with one `<slug>.md` per entity.
  A missing subdirectory means no entities of that type.
- Resolve a `loop_id` as `loop/<loop_id>.md`.
- Resolve a hypothesis by lowercased slug, a loop-prefixed slug for colliding historical ids, or
  a frontmatter `id:` line.
- Resolve a stop line through a frontmatter `line:` value or an item in a `lines:` list.
- Accept the event before warning about unresolved references. `lint` reports distinct unresolved
  references across the log.
- Impose no schema on entity content beyond the resolution rules above.

### Metrics and export

`fukuro report` computes these core KPIs over a time window:

- review rounds per merged PR;
- median lead time from open to merge;
- median ticks attributed per merged PR, with unattributed loop-level ticks reported separately;
- stop-line hits;
- human interventions.

Markdown is the portable human-facing report, JSON feeds dashboards, and text remains the terminal
default. `--out` writes a report for delivery to a host such as Obsidian, Notion, or GitHub.
Delivery remains a connector's responsibility; Fukuro ships no destination API clients.

For material leaving the local machine, `--profile public` structurally removes identifiers and
free text from the summary object before rendering. The database is private by default; export is
the disclosure boundary.

## Consequences

- The store is inspectable, portable, and usable without a daemon or hosted service.
- Append-only history preserves auditability and makes correction semantics part of every
  consumer's responsibility.
- Accept-then-warn prioritizes observation availability over referential strictness; `lint` and
  return-path review must handle unresolved references later.
- SQLite is a local source of evidence, not a multi-writer distributed telemetry backend.
- Hosted delivery and synchronization require external connectors or scheduled jobs.
- A return-path change carries an expected outcome; a later report confirms it or triggers an
  `improve_reverted` event and rollback.
