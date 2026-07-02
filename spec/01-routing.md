# 01 — Routing: the decision tree

## Job

Map a unit of incoming intent ("I want to investigate X", "implement Y", "record meeting Z") to
exactly one loop entry point, while logging the intent itself.

## Structure

A tree of skills, progressively disclosed:

- **Root (L1)**: a thin launcher. Contains only (a) a trigger table — one row per branch, with a
  "when to use" column — and (b) links to the branches. The root must stay small enough to load
  into any agent's context at session start.
- **Branches (L2)**: entry skills per work type (investigate / plan / implement / document / …).
- **Leaves (L3)**: concrete procedures, opened only when needed.

Rules:

1. **Route by trigger, not by taxonomy.** Each branch declares *when* it applies in observable
   terms. The router scans trigger columns; it does not reason about category philosophy.
2. **Log intent before routing.** Every routed work item starts with a written intent (what,
   why, success criteria) linked to whatever entity the branch creates. Orphan work — output with
   no recorded intent — is a stop condition.
3. **Progressive disclosure.** Never load a subtree that wasn't routed to. The tree exists so
   context stays small.
4. **A missing branch is a signal, not an error.** When no trigger matches, stop and record the
   gap; the return path (chapter 04) turns recorded gaps into new branches.

## Anti-patterns

- **Fat root**: procedures accumulating in the L1 launcher. Push them down; if a subtree grows
  large (e.g. implementation), promote it to an independent root and link it.
- **Routing by memory**: the agent "just knows" where things go. Every route must be reproducible
  from the trigger table by a fresh agent with no history.
