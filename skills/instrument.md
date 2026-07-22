---
name: fukuro-instrument
description: Wire fukuro telemetry into a loop so the return path gets usable numbers. Generates your local instrumentation convention (loop naming, event set, attribution rules, lifecycle timing, verification) from environment facts. Run once per environment, after bootstrap; converge assumes its output.
---

# instrument — wiring telemetry into a loop (meta-skill)

Telemetry that is wired casually produces numbers that lie: unattributed ticks, loops that look
19 minutes long when they took 4 hours, review effort nobody can count. This skill turns the
event log into something the return path can act on. As with every meta-skill here, each rule is
a scar from a real run — the run that followed all of them scored 100% attribution across five
concurrent PRs; the run before these rules existed scored 0%.

## Inputs (from your bootstrap-generated loop definition)

- tracker id scheme (issue numbers, ticket keys) and repo(s)
- reviewer identities (human, bot) and what *triggers* them (request? push? ready state?)
- merge authority (who actually merges — you, a human, a bot)

## 1. Name the loop before the first event

One loop = one goal-sized unit of work, and most loops are tracker-bound: name them
`<topic>-<tracker-id>` so they stay greppable and stable across sessions, and log the opening
event **with tracker attribution**:

```sh
fukuro log-event loop_start --loop <topic>-<id> --issue <id> --data '{"note":"<goal + entry signal>"}'
```

Scar: a run with perfect PR attribution still scored 0% *issue*-scoped coverage in `report`,
because the single opening event carried no `--issue`. Attribution you skip at the boundary
events is the attribution the report cannot reconstruct.

**Topic loops** (no tracker issue exists — docs housekeeping, meeting prep, exploration) are
first-class, not a workaround: `--loop` is always required, but `--issue` is only required when a
tracker item actually exists for this work. Name them `<topic>` (no numeric suffix), and put the
loop's own close condition in the start note instead of leaning on an issue's state:

```sh
fukuro log-event loop_start --loop <topic> --data '{"note":"<goal>. Closes when: <condition>"}'
```

A topic loop still gets `tick`/`review_round`/`loop_end` like any other — what it lacks is
`--issue`, not lifecycle. Do not invent a placeholder issue number to satisfy the table below; an
absent `--issue` on a topic loop is coherent, not a gap the report should flag.

## 2. The event set and when each fires

| moment | event |
|---|---|
| loop begins (not before, not re-logged) | `loop_start --issue <id>` (topic loop: omit `--issue`, state the close condition in the note — §1) |
| one unit of work done inside a tick | `tick --pr <n>` (see §3) |
| PR created | `pr_opened --issue <n> --pr <n>` (topic loop: omit `--issue`, same as `loop_start` — a topic loop can still produce a PR) |
| a reviewer produced feedback (each round) | `review_round --pr <n> --data '{"reviewer":"<who>","round":N}'` |
| PR merged (by whoever holds merge authority) | `merged --issue <n> --pr <n>` |
| tracker item closed | `issue_closed --issue <n>` |
| the goal is done — not "this session is done" | `loop_end --data '{"note":"<outcome>"}'` |

Judgment moments (findings, hypotheses, interventions, stop-line hits) are recorded as their own
typed events the instant they happen; they are the return path's raw material and cannot be
reconstructed later.

## 3. Tick attribution — the write-time contract

- In a loop with open PRs, a bare `tick` will be **refused** while the open-PR candidates are
  enumerable. Attach `--pr <n>` at write time; only the writer knows which PR the work was for.
- Work that genuinely spans PRs (syncing docs, cross-PR triage) is `--pr none` — an explicit
  acknowledgment, distinguishable from forgetting. Never dodge the contract by omitting the tick.
- Scar: before this contract, a multi-PR loop logged 13/13 ticks unattributed with the PR number
  sitting in free text; per-PR effort became unrecoverable.

## 4. Lifecycle timing

- **Do not close the loop early.** `loop_end` means the *goal* state was reached, not that the
  conversation paused. Scar: a loop closed at the 19-minute mark received 7 more events over the
  next 3.5 hours; the duration KPI lied and the correction options are all awkward (see the
  lifecycle-corrections issue). If a loop stays deliberately open, activity keeps it out of the
  stale ledger — that is by design.
- Do not backfill missing lifecycle events casually: id-ordered derivations can misread a late
  backfill as a re-opening. Record a `finding` instead and let the correction convention decide.

## 5. Reviewer bots are part of the loop — instrument their rounds

- Log a `review_round` per reviewer pass, with the reviewer's name and round number, even when
  the round produced zero findings — rounds-to-clean is a KPI.
- Discover how each bot is *triggered* (explicit request? push? ready-state event?) and write it
  into your loop definition. Scar: an event-driven approve/merge bot evaluated a PR exactly once,
  during a state it skipped, and never returned; re-firing the state-change event recovered it in
  under a minute. Silent bot absence looks identical to a slow bot — instrument the rounds and
  you can tell them apart.

## 6. Verify the wiring — never assume it

At the end of the first instrumented day (and weekly after):

```sh
fukuro report --days 1 --loop <your-loop>   # attribution coverage should be ~100%
fukuro lint                                  # lifecycle anomalies, orphan closes, id reuse
```

If PR-scoped coverage is below 100%, the gap is in §3. If the ledger or lint disagrees with what
you believe happened, the wiring (or the belief) is wrong — fix whichever before trusting the
numbers. Keep hypothesis/unit ids globally unique across loops; `lint` flags collisions.

## Output

Append the generated convention (loop naming, event table with your tracker/reviewer specifics,
verification cadence) to your bootstrap-generated loop definition. converge's tick then records
against these conventions without re-deciding them.
