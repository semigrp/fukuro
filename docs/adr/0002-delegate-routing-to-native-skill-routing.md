# ADR 0002: Delegate routing to native skill routing

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Incoming intent must be mapped to one loop entry point without relying on an agent's conversational
memory. The routing surface must also stay small enough to avoid loading every procedure into the
initial context.

Earlier Fukuro designs included a separate trigger tree. In practice, harnesses already expose a
native skill-routing mechanism, and skill descriptions are read and edited as part of running and
maintaining those skills. A parallel Fukuro tree would duplicate the mechanism and require manual
synchronization.

## Decision

Delegate routing to the harness's native skill routing. Skill descriptions are the trigger table;
Fukuro does not own a second routing tree.

The layer uses the following stable vocabulary:

- **Trigger-based routing:** each destination declares when it applies in observable terms. A
  fresh agent with the same trigger table must reach the same destination without relying on
  memory or category philosophy.
- **Progressive disclosure:** the session-start routing surface remains small and loads a subtree
  only after routing selects it.
- **Routed intent:** work begins with a written intent that states what, why, and success criteria,
  linked to the artifact created by the destination. Output without recorded intent is an orphan
  and a stop condition.
- **Unrouted work:** no matching trigger is a signal rather than a fatal routing error. Record the
  gap so the return path can propose a destination.

Fukuro retains this vocabulary because telemetry and return-path analysis need stable concepts
regardless of which harness performed the routing.

## Consequences

- Routing knowledge receives an automatic write path through normal skill maintenance.
- Harnesses may implement routing differently while emitting equivalent signals.
- Fukuro cannot guarantee routing behavior by itself; the host harness remains responsible for
  trigger resolution and progressive disclosure.
- Unrouted work and orphan work must be observable events or findings so [ADR 0005](0005-own-a-measured-return-path.md)
  can turn repeated gaps into measured improvements.
