# fukuro（復路）

> In Japanese, the outbound leg of a journey is called **ōro** (往路) — yes, it sounds like *ouro*boros.
> The way back is called **fukuro** (復路): the part of the loop where the snake finally eats its tail,
> and the system that ran the work turns around and improves *itself*.
> Also a pun: **fukurō** (梟) is the owl — the thing that watches your loops at night.

**fukuro** is a set of architecture decisions and minimal tooling for *agentic loop engineering* —
running AI coding agents (Claude, Codex, or anything else) as designed loops rather than
interactive prompts.

## The model: three layers + a return path

Most discussion of loop engineering enumerates ingredients (automations, worktrees, skills,
connectors, sub-agents, external state). fukuro maps them into layers with distinct jobs — and
deliberately **owns only the last one**. Delegation is the design
([ADR 0001](docs/adr/0001-separate-three-outbound-layers-and-a-return-path.md)): each outbound
structure lives where its write path is already automatic, because structures that demand manual
upkeep starve.

| Layer | Question it answers | Structure | Where it lives |
|---|---|---|---|
| 1. **Routing** | Which loop should this work enter? | Trigger-based routing | Your harness's native skill routing |
| 2. **Decomposition** | What are the verifiable units, in what order? | DAG — parent = plan, child = one PR-sized unit | The issue tracker |
| 3. **Convergence** | How does each unit reach *done*? | Stateless-tick feedback loop with verification gates | Skills & automations (the loop engine) |
| ↩ **Return path** | How does the system itself get better? | evaluate → audit → author, under *only improvements survive* | **fukuro** |

The essence of a loop is not the graph shape — it is **propose → act → verify → update external
state → decide to continue or stop**. The decision tree is a context-selection device on top of it;
the DAG is a decomposition device; the while-loop is the convergence engine.

fukuro's thesis: **the return path is the compounding half**, and it only compounds when baselines
are *measured*, not self-graded by the same model that did the work. That is why the first shipped
artifact here is a telemetry CLI, not another prompt library.

Fukuro measures routing without becoming a second router. Native skill routing remains in control;
a shadow omission evaluator may compare a task, an immutable derived skill index, observed skill
use, and outcome evidence without changing the active run. Advisory or blocking behavior requires
measured promotion gates and a later architecture decision
([ADR 0008](docs/adr/0008-measure-native-skill-routing-before-introducing-a-gate.md)).

## Telemetry CLI (zero dependencies)

Written in TypeScript and executed directly by Node — no build step, no runtime dependencies.
Requires Node ≥ 24 (native TypeScript type stripping + built-in `node:sqlite`). The database
lives at `~/.fukuro/fukuro.db` (override with `$FUKURO_DB`).

```sh
npx fukuro init
npx fukuro log-event pr_opened   --loop room-view --issue 462 --pr 472
npx fukuro log-event review_round --pr 472
npx fukuro log-event merged       --pr 472
npx fukuro report --days 7
npx fukuro report --format md --out ~/vault/fukuro-weekly.md   # export: Obsidian/Notion/GitHub
npx fukuro events --limit 20
npx fukuro lint                                                # integrity checks on the event log
npx fukuro import --file events.ndjson                         # ingest fukuro.telemetry-event/v1 from a producer
```

The CLI is deliberately agent-agnostic: call it from Claude Code hooks, Codex automations, CI, or
your shell. Canonical event kinds are documented in
[ADR 0006](docs/adr/0006-use-an-append-only-local-telemetry-store.md).

Optionally, point `$FUKURO_ONTOLOGY` at a markdown entity directory you own (`loop/`, `hypothesis/`,
`stop-line/`; one `<slug>.md` per entity) and `lint`/`log-event` will warn about references to
entities that don't exist — unset, nothing changes.

## Repository layout

```
docs/adr/   Accepted architecture decisions and their index
cli/        The telemetry CLI (node:sqlite, no deps)
skills/     Reference templates for the delegated outbound side (bootstrap / decompose / converge / instrument)
examples/   Minimal end-to-end loop using GitHub Issues only (WIP)
```

## Design principles

1. **State lives outside the model.** Every tick re-derives state from the source of truth
   (issue tracker, PRs, DB). No hidden in-context state → loops survive interruption and parallelize.
2. **Maker ≠ checker.** The model that wrote the change never grades it alone — a different
   reviewer (bot, other model, human) gates the merge. This applies to the return path too.
3. **Small verifiable units.** One child issue = one PR, roughly ≤ 100 changed lines. Verification
   quality is designed into the unit size.
4. **Stop lines, not vibes.** Irreversible or out-of-scope actions are enumerated *by name* and the
   loop halts on them, escalating to a human.
5. **Telemetry over rubrics.** Rubric self-scores saturate; review rounds per PR, lead time, and
   intervention counts do not. Improvements survive only if the metrics say so.
6. **Evidence before gates.** Observe native behavior, label failures independently, and pass a
   regression evaluation before adding advisory or blocking control to the execution path.

## What fukuro is not

- **Not a lightweight trace-observability tool.** Langfuse/LangSmith watch the *inside* of an
  execution (prompts, tokens, spans); fukuro measures the *outside shape* of a loop. Complementary,
  not competing.
- **Not a personal delivery dashboard.** DORA-style tools measure teams and pipelines; fukuro
  measures one harness and its return path.
- **Not a second skill router.** Skill repositories own trigger descriptions and the harness owns
  runtime selection. Fukuro measures omissions and manages reviewed improvement evidence.
- **The CLI is the entry point, not the product.** Vendor-built telemetry will absorb usage/cost/PR
  counters from below. What fukuro defends is the vocabulary: *what counts as loop improvement* —
  review rounds, stop lines, interventions, hypothesis lifecycles, return-path attribution.

## Status

Early. The core architecture decisions are accepted and indexed in
[`docs/adr/`](docs/adr/README.md); the CLI covers `init` / `ctx` / `log-event` / `events` / `report`
/ `lint` — including stateless context derivation (position recomputed from git and the event log;
nothing stored), structural redaction (`--profile public`), lifecycle and reference-integrity
checks against a user-owned entity directory (`$FUKURO_ONTOLOGY`, opt-in), hook recipes
([`docs/hooks.md`](docs/hooks.md)), and a maker≠checker pre-push gate recipe for direct-push repos
([`docs/checker.md`](docs/checker.md)). Roadmap: a GitHub-only golden-path example, a first-week
adoption path, the receiver-owned Ouro-to-Fukuro telemetry contract, a labelled native-routing
baseline, and outcome-based guards for the return path. Routing evaluation starts offline and then
runs in non-blocking shadow mode; advisory behavior is conditional on [ADR 0008's promotion
gates](docs/adr/0008-measure-native-skill-routing-before-introducing-a-gate.md#rollout-and-promotion-gates).

## License

[Apache-2.0](LICENSE)
