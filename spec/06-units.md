# 06 — Units of exploration: Concept, Hypothesis, Procedure

## Why the outbound path needs typed units

Chapters 01–03 describe how work *flows*. This chapter describes what the work *is* while it is
still being shaped — before it becomes an implementation unit (chapter 02). Exploration that only
produces prose gets lost; exploration that produces **typed units** can be routed, converged, and
measured like code can.

Three unit types cover the pre-implementation space:

| Unit | Question | Converges when | Typical failure |
|---|---|---|---|
| **Concept** | What is this phenomenon? What do we call it? | A named definition the team reuses | Same thing named three ways; boundaries drift |
| **Hypothesis** | Is this claim true? | A three-valued verdict: confirmed / refuted / still-open, with evidence | "Verified" by opinion; no closing condition |
| **Procedure** | How do we execute this repeatably? | Steps + stop lines + completion criteria a stranger can follow | Tribal knowledge; steps that only work for the author |

They chain: a **Concept** sharpens the vocabulary, a **Hypothesis** tests a claim expressed in that
vocabulary, a **Procedure** operationalizes what survived testing. Implementation (chapter 02–03)
consumes the survivors: a hypothesis about a contract becomes a scoped child issue; a procedure
becomes a skill (chapter 01) or a loop definition.

## The grill: how units get shaped

Units are formed in an adversarial dialogue — human and agent grilling each other:

1. **Capture**: name the raw observation (`concept_captured`) or claim (`hypothesis_opened`).
   A hypothesis must state its *closing condition* at open time: what evidence would confirm or
   refute it.
2. **Grill**: the agent interrogates the human's domain knowledge (and vice versa); each answer
   either narrows the unit or spawns a new one. Reading code/data beats opinion — prefer evidence
   the loop can fetch itself.
3. **Close**: record the verdict (`hypothesis_confirmed` / `hypothesis_refuted`) with the evidence
   pointer, or promote the result (`procedure_defined`). An open unit with no progress is a
   routing signal, not a failure — it queues research.

## Telemetry

Event kinds (chapter 05): `concept_captured`, `hypothesis_opened`, `hypothesis_confirmed`,
`hypothesis_refuted`, `procedure_defined`, `finding`. Convention: put a stable unit id and the
claim in `data`, e.g.

```sh
fukuro log-event hypothesis_opened --loop staff-checkin \
  --data '{"id":"H-1","claim":"no staff-side checkin write API exists","closes_when":"backend routes audited"}'
```

The exploration loop's convergence measure is the set of still-open hypotheses: opened minus
confirmed minus refuted. A discovery session that only emits `finding` events (no typed units) is
the exploration analogue of a PR with no tests.

## Mapping to host systems

Host knowledge bases keep the *content* (the definition text, the evidence, the steps); fukuro
keeps the *lifecycle* (when opened, how long open, verdict rate). One team's wiki may call these
whatever it likes — the unit types and their closing semantics are the portable part.
