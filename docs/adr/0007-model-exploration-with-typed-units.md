# ADR 0007: Model exploration with Concept, Hypothesis, and Procedure units

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Routing, decomposition, and convergence describe how work flows. Before work becomes an
implementation unit, exploration still needs artifacts that can be routed, closed, and measured.
Undifferentiated prose and generic findings do not encode what would make an investigation
converge.

## Decision

Represent pre-implementation exploration with three typed units:

| Unit | Question | Converges when | Typical failure |
|---|---|---|---|
| **Concept** | What is this phenomenon, and what do we call it? | The team reuses a named definition | Boundaries drift or one thing has several names |
| **Hypothesis** | Is this claim true? | Confirmed or refuted with evidence; otherwise it remains open with an updated closing condition | Opinion substitutes for evidence or no closing condition exists |
| **Procedure** | How do we execute this repeatably? | A stranger can follow steps, stop lines, and completion criteria | Knowledge remains author-specific |

The units form a progression: a Concept sharpens vocabulary, a Hypothesis tests a claim in that
vocabulary, and a Procedure operationalizes what survives. Implementation consumes the survivors
as scoped child issues, skills, or loop definitions.

Shape a unit through an adversarial human-agent dialogue:

1. **Capture:** name the observation or claim. A hypothesis states at open time which evidence
   would confirm or refute it.
2. **Grill:** both parties interrogate the unit. Prefer code and data the loop can fetch over
   opinion. Each answer narrows the unit or opens another one.
3. **Close:** record a hypothesis verdict with evidence or promote a surviving result to a
   procedure. An open unit without progress becomes a routing signal for research.

Use `concept_captured`, `hypothesis_opened`, `hypothesis_confirmed`, `hypothesis_refuted`,
`procedure_defined`, and `finding` events as defined by [ADR 0006](0006-use-an-append-only-local-telemetry-store.md).
A stable unit id and its claim belong in event data.

Host knowledge systems own the unit's content, such as definition text, evidence, and procedural
steps. Fukuro owns only the lifecycle needed to calculate open hypotheses and verdict behavior.

## Consequences

- Exploration gains explicit convergence semantics before implementation starts.
- A session that emits only untyped `finding` events is observable but has not produced a closed
  typed unit.
- Teams may use different names in their knowledge base, but lifecycle event types and closing
  semantics remain the portable contract.
- Fukuro cannot evaluate the truth of evidence by schema alone; independent review and the host
  knowledge system remain necessary.
- The set of open hypotheses is measurable as opened minus confirmed and refuted events.
