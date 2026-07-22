# ADR 0009: Model decisions as a typed unit

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

ADR 0007 typed pre-implementation exploration (Concept, Hypothesis, Procedure). Decisions still
have no verb: during a decision-heavy design day (14 operator adjudications, 2 design pivots in
one session), choices were recorded as `finding` events, conflating "something was observed or
learned" with "a choice was committed". A finding can be superseded by better evidence; a
decision binds subsequent work until revisited. Downstream entity derivation also cannot cut a
decision type until the corresponding verb exists in the event log.

## Decision

Add a `decision_made` event kind for recording an adjudication: the selection of one alternative
under stated objectives and constraints, by an identified owner.

Suggested payload shape (documentation, not schema enforcement — consistent with ADR 0006):

| Key | Meaning |
|---|---|
| `decision` | What was chosen, phrased as a choice, not a question |
| `alternatives` | What else was on the table, including the status quo |
| `owner` | Who committed (`human`, `ai`, or a name) |
| `snapshot` | The information state at decision time (links or one line) |
| `review_trigger` | What would reopen this decision |

A decision is not a finding: findings feed decisions and may contradict each other; a decision
selects and commits. A decision is not a hypothesis verdict: hypotheses close on evidence,
decisions close on authority. When a verdict leads to a choice, record both events.

## Consequences

- Decision-heavy sessions become countable and auditable (owner, alternatives, review trigger).
- Downstream knowledge systems can cut a decision entity type once the verb appears in logs,
  keyed by the same id conventions as the other typed units.
- `decision_made` joins the canonical-kind set and the loop-level suggested kinds, so the
  unknown-kind warning no longer fires for it.
