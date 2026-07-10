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
| `review_round` | one push that responds to reviewer feedback (see convention below) |
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

**Capture convention:** set `FUKURO_SESSION` in the environment that launches the agent; let
harness hooks fire the mechanical events (see [`docs/hooks.md`](../docs/hooks.md)) and context
derivation fill the fields. Manual flags are overrides, not the default path — manual discipline
is the least reliable component in the loop.

**`review_round` convention:** one round = one push that responds to reviewer feedback, however
many commits or thread replies it contains. Fix-up pushes for mistakes the loop caught *itself*
while responding (a broken gate run, a formatting miss) belong to the same round — the metric
counts reviewer-driven iterations, not raw pushes.

## Correcting the append-only log

Mistakes happen inside the store's own invariant: rows are never edited or deleted, so a wrong or
mis-timed event is corrected by *appending* a new row that declares what it corrects. Two
canonical markers carry that declaration, and every consumer (lint first, any future aggregation)
must honor them:

- **`data.backfill: true`** — this row records something that happened earlier and was written
  down late, usually with a historical `ts`. Ordering-sensitive checks treat a backfilled
  `hypothesis_opened` as prior to its close even when its row id (insertion order) is higher.
  Time order is judged by `ts` (row id only breaks ties); the marker covers the remaining case
  where the backfill kept a current `ts`.
- **`data.supersedes: <event id>`** or **`data.re_record: true`** — this row replaces an earlier
  event of the same kind (e.g. a `loop_end` re-recorded because the first one fired too early).
  Count-based checks exclude a superseding row from their tally: the declared re-record is the
  correction, not a second occurrence. `supersedes` names the exact row and is preferred;
  `re_record` is the anonymous form for when the original id is not at hand.

An unmarked duplicate or an unmarked out-of-order close remains a lint warning — the markers are
what distinguish "adjudicated: intentional" from "defect". History stays complete either way: the
superseded row is still there, and the correction is itself an event with a timestamp.

## The entity directory contract

`$FUKURO_ONTOLOGY` (opt-in, unset by default) points at a plain-markdown directory the *user*
owns — fukuro validates references into it and writes nothing. The contract is deliberately
minimal:

- **Layout:** one subdirectory per entity type — `loop/`, `hypothesis/`, `stop-line/` — and one
  `<slug>.md` file per entity. A missing subdirectory simply means no entities of that type.
- **Resolution:** a `loop_id` resolves against `loop/<loop_id>.md`. A hypothesis id resolves via,
  in order: its lowercased slug (`hypothesis/<id>.md`), a loop-prefixed slug
  (`hypothesis/<loop>-<id>.md`, for existing data where ids collide across loops), or a
  frontmatter `id:` line in any hypothesis file. A stop line resolves against frontmatter
  `line: <text>` or a `lines:` list entry in any `stop-line/*.md`.
- **Accept-then-warn:** telemetry writes are never refused over an unresolved reference.
  `log-event` appends first, then warns with the slug to create; `lint` reports distinct unknown
  references across the whole log. The moment an entity is first referenced is exactly the moment
  to create it — blocking the write would punish the behavior the check exists to encourage.
- **No further schema.** Beyond directory-per-type and one-file-per-entity, the files' content,
  frontmatter, and organization belong to the ontology's owner. fukuro greps the few lines above
  and imposes nothing else.

## Core KPIs

Computed by `fukuro report` over a time window:

- **review rounds / merged PR** — convergence quality; the single best regression detector for
  skill changes
- **median lead time (open → merge)** — end-to-end friction
- **ticks / merged PR (median)** — per-unit loop efficiency, computed from ticks *attributed to
  that PR* (wasted polling shows up here). Unattributed ticks are loop-level work (exploration,
  deciding the next unit) and are reported separately as the window total — mixing the two hides
  per-unit truth when children run in parallel
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
- **Redaction is structural, not cosmetic.** The DB is private by definition; the export is where
  leaks happen. `--profile public` removes identifiers and free text (loop ids, issue/PR numbers,
  hypothesis claims, stop-line names, payloads) from the summary *object itself* before any
  renderer runs — what isn't in the structure can't leak through a format. Anything leaving the
  machine for an audience beyond yourself should use it. Scrubbing text after publication is not a
  substitute: cross-references and timelines on host platforms are often immutable.

## Usage in the return path

A change applied in chapter 04 carries an expectation ("review rounds should drop"). The next
window's report either confirms it (`improve_applied` stands) or refutes it (`improve_reverted`,
change rolled back). This closes the loop: the system's self-improvement is gated by the same
kind of verification its workload is.
