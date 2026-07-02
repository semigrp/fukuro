# 05 — Telemetry: the measured substrate

## Why a database

External state answers *"where was I?"* — issue trackers and PRs already do that. Telemetry
answers *"is the system getting better?"* — and nothing in the default stack does. Without it, the
return path (chapter 04) grades itself and drifts. The store must be:

- **append-only** (events, not mutable status — history is the point)
- **agent-agnostic** (any runtime can write to it: a CLI callable from hooks, automations, CI)
- **local-first and boring** (one SQLite file; sync/export is a later concern)

## Event model

One table, `events`: `ts`, `session`, `loop_id`, `issue`, `pr`, `kind`, `data` (JSON). See
[`cli/schema.sql`](../cli/schema.sql).

### Canonical kinds

| kind | emitted when |
|---|---|
| `loop_start` / `loop_end` | a convergence loop begins / finishes a parent goal |
| `tick` | one stateless tick executed (chapter 03) |
| `pr_opened` | a child unit's PR is created |
| `review_round` | one fix→push→reply cycle on a PR |
| `merged` | a PR is merged |
| `issue_closed` | a child unit is closed out |
| `stop_line_hit` | the loop halted on a named stop line (`data.line`) |
| `human_intervention` | a human had to act for the loop to proceed (`data.reason`) |
| `improve_applied` / `improve_reverted` | a return-path change was kept / rolled back |
| `tokens` | cost sample (`data.count`, `data.model`) |
| `concept_captured` | a phenomenon was named/defined (spec/06; `data.id`, `data.name`) |
| `hypothesis_opened` | a testable claim was opened (`data.id`, `data.claim`, `data.closes_when`) |
| `hypothesis_confirmed` / `hypothesis_refuted` | a hypothesis closed with evidence (`data.id`, `data.evidence`) |
| `procedure_defined` | a repeatable procedure was written down (`data.id`) |
| `finding` | an untyped discovery worth recording (prefer typed units when possible) |

Unknown kinds are accepted (warn, don't block): a running loop must never fail because telemetry
was strict.

## Core KPIs

Computed by `fukuro report` over a time window:

- **review rounds / merged PR** — convergence quality; the single best regression detector for
  skill changes
- **median lead time (open → merge)** — end-to-end friction
- **ticks / merge** — loop efficiency (wasted polling shows up here)
- **stop-line hits** — tree holes and safety pressure
- **human interventions** — the real autonomy level, measured instead of claimed

## Export: reports go where people already look

Telemetry is only useful if humans see it, and humans live in Notion, Obsidian, GitHub — not in a
SQLite file. fukuro's answer keeps the zero-dependency, adapter-friendly shape:

- `fukuro report --format md` renders the report as portable Markdown (KPIs, open hypotheses,
  merged PRs). `--format json` feeds dashboards; `text` stays the terminal default.
- `--out <path>` writes to a file — pointing it into an Obsidian vault makes the vault the
  dashboard with zero glue.
- **Delivery is a connector's job, not fukuro's.** No API clients ship in this CLI. Post the
  Markdown with `gh issue comment --body-file`, let an agent paste it into a Notion page via MCP,
  or commit it to a repo on a schedule. One renderer, any destination.

## Usage in the return path

A change applied in chapter 04 carries an expectation ("review rounds should drop"). The next
window's report either confirms it (`improve_applied` stands) or refutes it (`improve_reverted`,
change rolled back). This closes the loop: the system's self-improvement is gated by the same
kind of verification its workload is.
