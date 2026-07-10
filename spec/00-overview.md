# 00 — Overview: three layers and a return path

## What problem this spec addresses

AI coding agents stopped being chat partners and became long-running execution systems. The
practical question moved from *"what do I prompt?"* to *"what loop do I design?"*. Public writing
on this shift (loop engineering, harness engineering) enumerates ingredients — automations,
worktrees, skills, connectors, sub-agents, external state — but rarely says how they compose.

fukuro's claim: they compose into **three layers plus a return path**, each with one job — and
fukuro itself owns only the return path.

## The atomic unit is a loop, not a graph

The essence of agentic work is the feedback cycle:

```
propose → act → verify → update external state → continue or stop
```

Everything else is a device layered on top of this cycle:

- A **decision tree** selects *which* loop a piece of work enters (context selection).
- A **DAG** orders *many small loops* relative to each other (decomposition and dependency).
- The **while-loop** is the convergence engine that runs each unit to done.

Arguing "is it a DAG or a decision tree?" mistakes the devices for the essence. A system needs all
three, kept separate, so each can stay simple.

## The four parts — and where each one lives

| Part | Job | Where it lives | Chapter |
|---|---|---|---|
| Routing | Map incoming intent to the right loop | The harness's native skill routing | [01](01-routing.md) |
| Decomposition | Split a goal into a parent plan and PR-sized child units | The issue tracker | [02](02-decomposition.md) |
| Convergence | Run each unit to done through gates and stop lines | Skills and automations (executable behavior) | [03](03-convergence.md) |
| Return path | Improve the system itself, under measured baselines | **fukuro**: this spec and its CLI | [04](04-return-path.md) |

The return path is the namesake (復路, *fukuro* — the way back) because it is the compounding
half: routing, decomposition, and convergence produce output; the return path produces *a better
system*. Skipping it leaves you with a fast loop that never learns.

## Delegation is the design

Earlier drafts of this spec carried a general theory of the outbound leg — a fukuro-owned trigger
tree, a prescribed decomposition workflow, a loop-engine procedure. Field use showed those
structures do not survive as fukuro-owned artifacts. They get absorbed by things that already have
an **automatic write path**:

- **Routing** is delegated to the harness's native skill routing. Skill descriptions *are* the
  trigger table, and the harness maintains and consults them as part of doing the work. A parallel
  fukuro-owned trigger tree is a knowledge base whose write side is manual — maintaining triggers
  is a discipline nobody keeps.
- **Decomposition instances** are delegated to the issue tracker. That is design principle 1
  (state lives outside the model) applied to plans: filing, linking, and closing issues happen as
  a side effect of the work itself. fukuro keeps the unit-size doctrine as vocabulary; it does not
  own the DAG.
- **The nouns** — which loops, hypotheses, and stop lines actually exist — are delegated to a
  user-owned entity directory: plain files owned by the user, not by this spec. fukuro's tooling
  validates references into that directory; the return path proposes creating and pruning its
  entries (chapter 04).

The reason fits in one sentence: **write paths must be automatic or the structure starves.** A
structure stays alive only when the process that does the work also writes the structure as a side
effect. Anything fukuro owned in parallel to the host systems would depend on manual upkeep, and
manual upkeep decays.

What fukuro durably owns: the return-path doctrine (04), the measurement machinery (the telemetry
CLI, 05), and the vocabulary of loop improvement (05/06). The three-layer map above stays in this
chapter as orientation — chapters 01–03 keep the definitions each layer contributes and state
where the layer actually lives, without claiming ownership of the territory.

## Relationship to prior art

- **Loop engineering** (Osmani): the six anatomy components map onto these layers — automations
  and connectors serve all layers; worktrees and sub-agents live in convergence; skills live in
  routing; external state is the substrate of everything (chapter 05).
- **Harness engineering** (OpenAI): agent-legible environments and docs-as-context are
  preconditions for convergence; fukuro adds an explicit self-improvement loop on top.
- **Building effective agents** (Anthropic): routing ≈ the routing workflow; decomposition ≈
  orchestrator-workers; the return path ≈ evaluator-optimizer applied to the harness itself.

## Non-goals

- Not an agent framework or SDK. fukuro specifies *structure and measurement*; the agent runtime
  (Claude Code, Codex, anything) is pluggable.
- Not a prompt library. Skill templates here are structural scaffolds, not model-tuned prompts.
- Not an outbound-path methodology. Chapters 01–03 define vocabulary and point at the systems
  that own each layer; they do not prescribe how to operate those systems.
