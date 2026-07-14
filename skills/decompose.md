---
name: fukuro-decompose
description: Turn a goal into a verifiable DAG and split the buildable from the blocked. Derives the current picture from the canon PLUS today's conversation, tags every claim by evidence type, and emits a human-readable DAG so misalignment surfaces before code does. Distilled from real decomposition runs — use before cutting issues from any goal.
---

# decompose — goal → verifiable DAG (meta-skill)

Decomposition is the *expand* phase
([ADR 0003](../docs/adr/0003-store-decomposition-dags-in-the-issue-tracker.md)): one goal →
a dependency DAG whose nodes are units small enough to verify. This skill is the generic
procedure; the goal arrives at runtime. It ships as a generator, not a fixed plan — you supply the
goal, it produces the DAG and the issues.

The hard part is not drawing the graph. It is **not fooling yourself about what you know.** The
rules below all exist because real runs failed in specific ways; each is a scar.

## Step 1 — derive the current picture (two sources, not one)

- **Canon is stale by design.** A wiki/goal page reflects when it was last written; the truth moved
  in conversation since. Always cross the canon with **today's conversation log** (chat, meeting
  notes, threads). If you decompose from the canon alone you will plan work that a message already
  blocked or changed. *(scar: a goal page said a step was in-progress; a same-day thread had
  escalated it to a hard block — reading canon-only would have planned the blocked work.)*
- Record where each fact came from. You will tag claims with it in Step 3.

## Step 2 — grill for what cannot be derived

Some inputs live only in a human's head and appear nowhere in code or docs:

- **Technical-choice policy** ("use API v2 for X", "this store is deprecated") is *not derivable
  from the codebase* — the code shows the current state, not the intended direction. Ask. *(scar:
  concluded "v2 not needed" from the code showing v1-only, while the standing policy was "bookings
  use v2" — held only in the maintainer's memory.)*
- Merge authority, stop lines, unit size, approval gates (same as bootstrap Phase 2).
- If unknown, do not guess — record an open hypothesis with a closing condition and take the
  conservative default.

## Step 3 — tag every claim by evidence type

The review-detection payload of a DAG comes less from marking uncertainty than from marking
**where each claim's confidence comes from.** Tag each node/edge:

- `[code]` verified against source (file:line)
- `[doc]` from a document — **note staleness risk; human docs can be old or wrong**
- `[memory]` from a human's recollection — align, don't assume it's ground truth
- `[inference]` derived/reasoned — **highest error rate; reviewers should attack these first**

Errors cluster in `[inference]` and stale `[doc]`/`[memory]`, *not* in nodes you already flagged
uncertain. A DAG review is a **two-way alignment device**, not an AI-error catcher: either side may
hold the correct piece (the maintainer's memory, your code reading), and the truth is often their
synthesis.

## Step 4 — split buildable from blocked, by verifiability

- **Buildable** = the contract/decision it needs is verifiable now. These become issues (Step 5).
- **Blocked** = waiting on an external decision, approval, or unverifiable contract. **Do not cut
  issues for these** — an open issue nobody can act on is noise. Record them with an explicit
  **restart trigger** (what event unblocks it) in the plan doc, not the tracker.
- Never cut a child on a contract you only assume. Verifiability decides scope.

## Step 5 — emit a human-readable DAG, then the issues

- **Always render the DAG in plain markdown** (a mermaid graph + a buildable/blocked table) where
  the human actually reviews. Medium is not the point — a one-page markdown DAG is readable by
  human and agent alike; put it where review happens. This externalization is what makes
  misalignment, memory gaps, and slop visible. *(scar: rendering the DAG for review surfaced a
  forgotten fact and an implicit blocker in one pass.)*
- **State markers are transcribed, not inferred.** Copy ✅/⏳/❌ from the source verbatim. Summarize
  freely, but never compress a state — folding an ⏳ item into a ✅ group is how scope silently
  drops. *(scar: an ⏳ "identify via Info Code" item got absorbed into a ✅ group during
  summarization and fell out of the plan.)*
- Approval gate before fan-out: present the DAG and the issue list; file only after the human
  approves. Filing N issues is outward-facing and semi-irreversible.
- Bidirectional links: plan ⇄ issues; blocked items stay in the plan with their triggers.

## Stop lines for this skill itself

- Decomposing from canon without checking today's conversation → stop, read the conversation.
- Cutting an issue on an assumed/unverified contract → stop, verify or mark blocked.
- Inferring a state marker instead of transcribing it → stop, quote the source.
- Filing issues before the human approved the DAG → stop.
- Publishing the DAG externally with host-identifying content → use redacted export
  ([ADR 0006](../docs/adr/0006-use-an-append-only-local-telemetry-store.md)).
