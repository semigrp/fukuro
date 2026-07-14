# ADR 0001: Separate three outbound layers and a return path

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

AI coding agents have moved from chat partners to long-running execution systems. The practical
question is no longer only *"what do I prompt?"* but *"what loop do I design?"*. Public writing on
loop engineering and harness engineering enumerates automations, worktrees, skills, connectors,
sub-agents, and external state, but does not consistently say how those pieces compose or who
owns them.

The essence of agentic work is one feedback cycle:

```text
propose -> act -> verify -> update external state -> continue or stop
```

A decision tree selects which loop a piece of work enters. A DAG orders many small loops. A
while-loop drives each unit to convergence. Treating those devices as competing models conflates
separate responsibilities.

Structures also decay when their write path depends on separate manual upkeep. Routing tables,
decomposition plans, and executable procedures already have host systems that write them as part
of doing the work.

## Decision

Model an agent system as three outbound layers plus a return path, with one responsibility and
one owner per layer:

| Part | Responsibility | Owner | Detail |
|---|---|---|---|
| Routing | Map incoming intent to the right loop | The harness's native skill routing | [ADR 0002](0002-delegate-routing-to-native-skill-routing.md) |
| Decomposition | Split a goal into PR-sized, dependency-ordered units | The issue tracker | [ADR 0003](0003-store-decomposition-dags-in-the-issue-tracker.md) |
| Convergence | Run each unit through verification gates and stop lines | Skills and automations | [ADR 0004](0004-run-convergence-as-stateless-gated-ticks.md) |
| Return path | Improve the system under measured baselines | Fukuro | [ADR 0005](0005-own-a-measured-return-path.md) |

Fukuro owns the return-path doctrine, the telemetry machinery, and the vocabulary used to measure
loop improvement. It does not duplicate the host systems that own the outbound layers.

The outbound nouns that telemetry references, such as loops, hypotheses, and stop lines, live in
a user-owned entity directory. Fukuro validates references into that directory and may propose
creating or pruning entries through the return path, but it does not own or write the directory.

The governing ownership rule is: **a structure must have an automatic write path or it will
starve**. A structure remains alive when the process that performs the work also updates the
structure as a side effect.

## Rationale

- Native skill descriptions are already consulted and maintained with routing behavior. A
  parallel Fukuro trigger tree would have a manual write side.
- Filing, linking, and closing issues naturally maintain decomposition state. A parallel Fukuro
  DAG would duplicate that source of truth.
- Skills, hooks, and automations are exercised when convergence runs. A prose copy of executable
  behavior would drift silently.
- The return path has no equivalent owner in the default agent stack, so Fukuro owns its doctrine
  and measured event lifecycle.

This structure is compatible with prior work: loop-engineering components serve one or more of
the layers; harness engineering provides the agent-legible environment needed by convergence;
routing and orchestrator-worker patterns map to the first two layers; evaluator-optimizer applied
to the harness itself maps to the return path.

## Consequences

- Fukuro stays agent-runtime agnostic and does not become an agent framework, SDK, prompt
  library, or outbound-path orchestrator.
- Routing, decomposition, and convergence remain independently replaceable because their
  contracts are vocabulary and events, not Fukuro-owned implementations.
- Operators must configure the host harness, issue tracker, and executable loop behavior; Fukuro
  deliberately does not provide a second control plane for them.
- The user-owned entity directory is an external contract. Missing references produce signals
  and warnings, not a second store that Fukuro silently maintains.
- The return path becomes the compounding half of the system: outbound execution produces work,
  while measured return-path cycles produce a better system.
