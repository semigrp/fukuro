# ADR 0008: Measure native skill routing before introducing a gate

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

[ADR 0002](0002-delegate-routing-to-native-skill-routing.md) makes the harness's native skill
routing the routing owner and treats repository skill descriptions as its trigger table. This
avoids a second routing tree, but implicit routing can still omit a skill that the task needed.
Today Fukuro has neither a labelled routing baseline nor an end-to-end contract for comparing the
skills available at task start, the skills actually used, and the outcome.

Proposals to add an LLM selector and critic, graph ranking, blocking hooks, or a runtime skill graph
in Boros would make the omission visible only after introducing another authority into the
critical path. That would duplicate the source of truth before demonstrating that the additional
mechanism improves recall, and it would risk letting the same mechanism choose and grade a route.

OpenAI's loop-engineering examples use production evidence to create a reviewed finding, turn the
finding into a focused evaluation, and retain a scoped change only when the evaluation improves.
The routing return path should follow that order.

## Decision

Keep native skill routing as the only runtime routing authority. Introduce proof-carrying skill
routing ideas first as a **Fukuro-owned shadow omission evaluator**, not as a router or gate.

The shadow evaluator observes a task, a versioned view of the skills that were available, evidence
of which skills were used, and the eventual outcome. It may identify a required-but-unused skill
and explain that judgment. It must not alter the prompt, select the runtime route, block tool use,
grant permissions, mutate a skill, or write to Boros.

### Ownership boundaries

| Concern | Owner |
|---|---|
| Skill instructions, description, and trigger wording | The skill's repository `SKILL.md` |
| Runtime skill discovery and selection | The harness's native routing |
| Explicit procedure execution and pinned artifacts | Ouro |
| Durable concepts, procedure definitions, evidence, and decisions | Boros |
| Routing assessments, outcomes, findings, and improvement measurement | Fukuro |
| Approved skill changes | The skill repository through its normal review path |

Boros does not gain a `skill` entity kind or become a runtime routing dependency. A Boros
procedure may reference a durable skill artifact by the shared artifact-reference convention, but
the skill remains owned by its repository. Ouro may pin a skill or procedure artifact for an
explicit run, but it does not select implicit skills for the harness.

### Derived skill index

An evaluator may consume a read-only **SkillIndex** generated from repository skill metadata. The
index is a cache and comparison surface, not a second source of truth. Each snapshot must identify:

- the skill's stable repository-relative identity and source reference;
- the exact description presented to native routing;
- a content digest and generator version;
- the repository revision and generation time.

The snapshot must be immutable once referenced by an assessment. Regeneration reflects repository
changes; it never writes back into `SKILL.md`.

### Assessment contract

A routing assessment must carry enough evidence for an independent reviewer to reproduce or
challenge it:

- task and run references, with sensitive prompt content kept in the source artifact store;
- the SkillIndex digest and evaluator version;
- observed skill use and the evidence used to infer it;
- required, optional, and required-but-unused skill ids;
- a bounded rationale and confidence for each required skill;
- outcome evidence and an explicit `unknown` state when attribution is not possible.

An LLM may act as the fast critic, but its score is not outcome evidence. Prefer an evaluator that
is independent from the workload author, require structured output, retain the evidence references,
and calibrate it against reviewed examples. Repeated or high-impact omissions become Fukuro
`finding` events only after review; raw judge output is assessment data, not a canonical finding.

### Rollout and promotion gates

Adopt the mechanism in this order:

1. Complete a receiver-owned telemetry contract and one Ouro-to-Fukuro golden path so task, run,
   artifact, and outcome references can be joined without parsing prose.
2. Build a reviewed offline routing set from real tasks, including tasks where no extra skill is
   required, and measure native routing without changing execution.
3. Run the evaluator in shadow mode at task submission and completion. Hooks only capture
   references and schedule evaluation; they do not inject context or control tools.
4. Show advisory findings only after the evaluator meets all acceptance criteria below.
5. Introduce any routing gate only through a later ADR with evidence from the advisory phase,
   explicit fallback behavior, latency and cost budgets, and a human-controlled kill switch.

The minimum advisory acceptance criteria are:

- at least 97% recall for independently labelled required skills;
- zero critical omissions in the evaluation set;
- at least 50% fewer required-skill omissions than the native-routing baseline;
- no more than 1.5 unnecessary skill suggestions per task on average;
- at least 95% agreement when irrelevant skill ordering is perturbed;
- a regression set that includes no-skill, ambiguous, multi-skill, and adversarial-description
  cases.

Thresholds are promotion gates, not claims about current performance. They may be tightened by a
later ADR but must not be relaxed based only on the evaluator's self-assessment.

### Hook boundary

During shadow mode, harness hooks may observe task submission and run completion and enqueue a
non-blocking assessment after the receiver contract exists. They must fail open and must not:

- run an LLM after every tool call;
- intercept pre-tool or permission decisions;
- add suggested skills to the active context;
- prevent a run from starting or completing;
- emit raw model judgments as reviewed `finding` events.

### Deferred mechanisms

Do not add CEC-HRG coverage, PageRank-like or TCOR ranking, first-class hyperedges, route
certificates, a Boros runtime skill graph, Codex App Server/SDK enforcement, or bidirectional
knowledge synchronization in this phase. Any one of these must answer a measured failure of the
shadow design and be introduced by its own ADR.

## Consequences

- [ADR 0002](0002-delegate-routing-to-native-skill-routing.md) remains accepted and unchanged;
  this decision adds a measured return path around native routing rather than superseding it.
- The first deliverable is evidence and an evaluation set, not a new router.
- Fukuro can detect and improve recurring omissions while preserving one routing source of truth.
- LLM judgment provides scalable triage, while independent labels and outcome evidence remain the
  promotion authority.
- Hooks can automate observation without making Fukuro a runtime availability dependency.
- Some omissions remain unattributable until the receiver and skill-use evidence contracts exist;
  they must be recorded as `unknown`, not forced into a score.

## References

- [ADR 0005: Make the measured return path Fukuro's responsibility](0005-own-a-measured-return-path.md)
- [ADR 0006: Use an append-only, local-first telemetry store](0006-use-an-append-only-local-telemetry-store.md)
- [OpenAI: Building a self-improving tax agent with Codex](https://openai.com/index/building-self-improving-tax-agents-with-codex/)
- [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/)
- [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI: Hooks](https://learn.chatgpt.com/docs/hooks)
