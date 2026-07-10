# 01 — Routing: the decision tree

## Job

Map a unit of incoming intent ("I want to investigate X", "implement Y", "record meeting Z") to
exactly one loop entry point, while logging the intent itself.

## Vocabulary this layer contributes

- **Trigger-based routing.** Each destination declares *when* it applies in observable terms.
  Routing is reproducible: a fresh agent with no history reaches the same destination from the
  same trigger table — never from memory or category philosophy.
- **Progressive disclosure.** The routing surface loaded at session start stays small; a subtree
  is loaded only when routed to. The tree shape exists so context stays small.
- **Routed intent.** Every routed work item starts with a written intent (what, why, success
  criteria) linked to whatever the destination creates. Orphan work — output with no recorded
  intent — is a stop condition.
- **Unrouted work.** When no trigger matches, that is a signal, not an error: the gap is recorded,
  and the return path (chapter 04) turns recorded gaps into new destinations.

## Where this lives

This layer is delegated to the **harness's native skill routing**. In practice, skill descriptions
*are* the trigger table: the harness consults them on every request, and they are edited in the
same motion as the skills they describe — the write path is automatic. A fukuro-owned trigger tree
duplicates that mechanism with a manual write side, and routing knowledge whose write path is
manual starves (chapter 00).

fukuro keeps the vocabulary above because telemetry references it: an unrouted-work event or an
orphan-work stop is a return-path signal regardless of which mechanism performed the routing.
