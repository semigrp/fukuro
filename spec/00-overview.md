# 00 — Overview: three layers and a return path

## What problem this spec addresses

AI coding agents stopped being chat partners and became long-running execution systems. The
practical question moved from *"what do I prompt?"* to *"what loop do I design?"*. Public writing
on this shift (loop engineering, harness engineering) enumerates ingredients — automations,
worktrees, skills, connectors, sub-agents, external state — but rarely says how they compose.

fukuro's claim: they compose into **three layers plus a return path**, each with one job.

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

## The four parts

| Part | Job | Chapter |
|---|---|---|
| Routing | Map incoming intent to the right loop via trigger-based branches | [01](01-routing.md) |
| Decomposition | Split a goal into a parent plan and PR-sized child units with explicit dependencies | [02](02-decomposition.md) |
| Convergence | Run each unit to done: stateless ticks, verification gates, maker/checker separation | [03](03-convergence.md) |
| Return path | Improve the system itself, under measured baselines | [04](04-return-path.md) |

The return path is the namesake (復路, *fukuro* — the way back) because it is the compounding
half: routing, decomposition, and convergence produce output; the return path produces *a better
system*. Skipping it leaves you with a fast loop that never learns.

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
